// Odds-seeded, self-correcting bracket projection.
// TS port of reference/bracket-prediction.py — reproduces its pre-tournament
// output exactly, and accepts pluggable ranking()/winnerOf() for live blending.
// See reference/PREDICTION.md.

import { FIXTURES, FIXTURE_BY_NUM } from "./fixtures";
import { TEAM_BY_NAME } from "../../data/draft";

const FX = FIXTURES;
const M = FIXTURE_BY_NUM;

export const GROUPS = "ABCDEFGHIJKL".split("");

/** group letter -> the four team names in that group (group games only). */
const GROUP_TEAMS: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const m of FX) {
    if (m.stage !== "group" || !m.group) continue;
    (out[m.group] ??= []);
    for (const t of [m.team1, m.team2]) {
      if (!out[m.group].includes(t)) out[m.group].push(t);
    }
  }
  return out;
})();

const oddsOf = (team: string): number => TEAM_BY_NAME[team]?.oddsValue ?? Infinity;

/** Order a group's four teams [1st,2nd,3rd,4th]. Default: by odds (lower = stronger). */
export type Ranking = (group: string) => string[];
/** Pick the advancing team between two. Default: better odds.
 *  `matchNum` is the knockout fixture being resolved, so live callers can look up the
 *  real result for exactly that match rather than guessing from team names. */
export type WinnerOf = (a: string, b: string, matchNum: number) => string;

export const oddsRanking: Ranking = (group) =>
  [...(GROUP_TEAMS[group] ?? [])].sort((a, b) => oddsOf(a) - oddsOf(b));

export const oddsWinnerOf: WinnerOf = (a, b) => (oddsOf(a) <= oddsOf(b) ? a : b);

export interface BracketInputs {
  ranking?: Ranking;
  winnerOf?: WinnerOf;
}

export interface ResolvedMatch {
  num: number;
  round: string;
  team1: string; // resolved team name (or original slot code if unresolvable)
  team2: string;
  winner: string | null; // null for the third-place match
}

export interface BracketProjection {
  /** The 8 projected qualifying third-placed teams, ranked best-first. */
  qualifyingThirds: string[];
  /** Resolved knockout matches, num 73..104. */
  matches: ResolvedMatch[];
  champion: string;
  /** slot code -> resolved team, for confirmed/predicted tagging upstream. */
  resolveSlot: (code: string) => string;
  /** match num -> projected winner (memoized). */
  winnerOfMatch: (num: number) => string;
}

/** Build the full projection from pluggable inputs. */
export function projectBracket(inputs: BracketInputs = {}): BracketProjection {
  const ranking = inputs.ranking ?? oddsRanking;
  const winnerOf = inputs.winnerOf ?? oddsWinnerOf;

  // pos[(group, place)] -> team
  const pos: Record<string, string> = {};
  for (const g of GROUPS) {
    const r = ranking(g);
    for (let i = 0; i < 4; i++) pos[`${g}${i + 1}`] = r[i];
  }

  // best-8 thirds, ranked by the same ranking() comparator basis (odds default).
  const allThirds = GROUPS.map((g) => ranking(g)[2]).filter(Boolean);
  const qualifyingThirds = [...allThirds]
    .sort((a, b) => oddsOf(a) - oddsOf(b))
    .slice(0, 8);
  const groupOf = (team: string): string => TEAM_BY_NAME[team]?.group ?? "";

  // collect best-thirds slots in order of first appearance ("3A/B/C/D/F").
  const slots: Array<{ code: string; groups: Set<string> }> = [];
  const seen = new Set<string>();
  for (const m of FX) {
    for (const c of [m.team1, m.team2]) {
      if (c.startsWith("3") && c.includes("/") && !seen.has(c)) {
        seen.add(c);
        slots.push({ code: c, groups: new Set(c.slice(1).split("/")) });
      }
    }
  }

  // bijective backtracking: qualifying third -> a slot whose allowed set contains its group.
  const assign: Record<string, string> = {};
  const used = new Set<string>();
  const matchThirds = (i: number): boolean => {
    if (i === qualifyingThirds.length) return true;
    const t = qualifyingThirds[i];
    const g = groupOf(t);
    for (const { code, groups } of slots) {
      if (used.has(code) || !groups.has(g)) continue;
      used.add(code);
      assign[code] = t;
      if (matchThirds(i + 1)) return true;
      used.delete(code);
      delete assign[code];
    }
    return false;
  };
  if (!matchThirds(0)) {
    throw new Error("no valid thirds assignment (should never happen)");
  }

  const memo: Record<number, string> = {};
  const resolveSlot = (code: string): string => {
    if (TEAM_BY_NAME[code]) return code; // already a real team
    const groupSlot = /^([12])([A-L])$/.exec(code);
    if (groupSlot) return pos[`${groupSlot[2]}${groupSlot[1]}`] ?? code;
    if (code.startsWith("3") && code.includes("/")) return assign[code] ?? code;
    const wl = /^([WL])(\d+)$/.exec(code);
    if (wl) {
      const n = Number(wl[2]);
      const w = winnerOfMatch(n);
      if (wl[1] === "W") return w;
      // loser: the side of match n that didn't win
      const t1 = resolveSlot(M[n].team1);
      const t2 = resolveSlot(M[n].team2);
      return w === t2 ? t1 : t2;
    }
    return code; // unresolvable slot — leave as-is
  };

  const winnerOfMatch = (num: number): string => {
    if (memo[num] !== undefined) return memo[num];
    const m = M[num];
    const w = winnerOf(resolveSlot(m.team1), resolveSlot(m.team2), num);
    memo[num] = w;
    return w;
  };

  const matches: ResolvedMatch[] = [];
  for (let n = 73; n <= 104; n++) {
    const m = M[n];
    const isThird = m.round === "Match for third place";
    matches.push({
      num: n,
      round: m.round,
      team1: resolveSlot(m.team1),
      team2: resolveSlot(m.team2),
      winner: isThird ? null : winnerOfMatch(n),
    });
  }

  return {
    qualifyingThirds,
    matches,
    champion: winnerOfMatch(104),
    resolveSlot,
    winnerOfMatch,
  };
}
