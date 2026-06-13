// Derive live tournament state from an ESPN snapshot: group rankings, advancement,
// eliminations, and a live-blended bracket projection. Pure functions (no DOM, no fetch)
// so they can be reasoned about and unit-checked independently. See reference/PREDICTION.md.

import { TEAM_BY_NAME } from "../../data/draft";
import { FIXTURES, FIXTURE_BY_NUM } from "./fixtures";
import { projectBracket, oddsRanking, oddsWinnerOf, GROUPS } from "./bracket";
import type { GroupRow, LiveResult } from "./types";
import type { BracketProjection } from "./bracket";

export interface LiveState {
  /** Live (or odds-fallback) group ranking: group -> [1st..4th] team names. */
  ranking: Record<string, string[]>;
  /** Teams confirmed into the R32 (top-2 of a finished group, or a best-8 third). */
  advanced: Set<string>;
  /** Teams eliminated (can't advance / lost their knockout tie). */
  eliminated: Set<string>;
  /** Groups whose three rounds are all complete (positions confirmed). */
  finishedGroups: Set<string>;
  /** True once every group game is final (switch bracket to real KO fixtures). */
  groupStageComplete: boolean;
  /** Live-blended bracket projection. */
  bracket: BracketProjection;
  /** Convenience: confirmed knockout participants (feeder match final). */
  confirmedSlots: Set<string>; // team names locked into their KO slot
}

const oddsOf = (t: string) => TEAM_BY_NAME[t]?.oddsValue ?? Infinity;
const groupOf = (t: string) => TEAM_BY_NAME[t]?.group ?? "";

/** group -> its three fixture nums, for completeness checks. */
const GROUP_FIXTURE_NUMS: Record<string, number[]> = (() => {
  const out: Record<string, number[]> = {};
  for (const m of FIXTURES) if (m.stage === "group" && m.group) (out[m.group] ??= []).push(m.num);
  return out;
})();

const TEAMS_IN_GROUP: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const g of GROUPS) out[g] = oddsRanking(g); // any order; recomputed live below
  return out;
})();

function liveRanking(group: string, tables: Record<string, GroupRow[]>): string[] {
  const rows = tables[group];
  if (rows && rows.length === 4) {
    // ESPN order, with odds as the final tiebreaker for not-yet-separated ties.
    return [...rows]
      .sort((a, b) =>
        b.points - a.points || b.gd - a.gd || b.gf - a.gf || oddsOf(a.team) - oddsOf(b.team))
      .map((r) => r.team);
  }
  return oddsRanking(group); // fallback: pre-tournament odds order
}

/** Best-8 third-placed teams under live ranking (Pts→GD→GF→odds), or odds pre-tournament. */
function bestThirds(ranking: Record<string, string[]>, tables: Record<string, GroupRow[]>): string[] {
  const thirds = GROUPS.map((g) => ranking[g]?.[2]).filter(Boolean) as string[];
  const rowOf = (t: string): GroupRow | undefined => tables[groupOf(t)]?.find((r) => r.team === t);
  return [...thirds]
    .sort((a, b) => {
      const ra = rowOf(a), rb = rowOf(b);
      if (ra && rb) return rb.points - ra.points || rb.gd - ra.gd || rb.gf - ra.gf || oddsOf(a) - oddsOf(b);
      return oddsOf(a) - oddsOf(b);
    })
    .slice(0, 8);
}

export function deriveLiveState(
  results: Record<number, LiveResult>,
  tables: Record<string, GroupRow[]>,
): LiveState {
  // 1) live group rankings
  const ranking: Record<string, string[]> = {};
  for (const g of GROUPS) ranking[g] = liveRanking(g, tables);

  // 2) which groups are fully played
  const finishedGroups = new Set<string>();
  for (const g of GROUPS) {
    const nums = GROUP_FIXTURE_NUMS[g] ?? [];
    if (nums.length > 0 && nums.every((n) => results[n]?.completed)) finishedGroups.add(g);
  }
  const groupStageComplete = finishedGroups.size === GROUPS.length;

  // 3) advancement: top-2 of finished groups + best-8 thirds (only meaningful once thirds settle).
  const advanced = new Set<string>();
  for (const g of finishedGroups) {
    advanced.add(ranking[g][0]);
    advanced.add(ranking[g][1]);
  }
  // best-thirds confirmed only when the whole group stage is done.
  if (groupStageComplete) {
    for (const t of bestThirds(ranking, tables)) advanced.add(t);
  }

  // 4) eliminations
  const eliminated = new Set<string>();
  //   group stage: in a finished group, 4th place is out; 3rd is out unless it makes best-8.
  const survivingThirds = groupStageComplete ? new Set(bestThirds(ranking, tables)) : null;
  for (const g of finishedGroups) {
    const r = ranking[g];
    eliminated.add(r[3]); // 4th always out
    if (survivingThirds && !survivingThirds.has(r[2])) eliminated.add(r[2]);
  }
  //   group stage in progress: mathematically-eliminated detection
  for (const g of GROUPS) {
    if (finishedGroups.has(g)) continue;
    for (const t of mathematicallyOut(g, tables, results)) eliminated.add(t);
  }
  //   knockout eliminations need resolved slot→team, so they're computed in 5b below.

  // 5) live-blended bracket: use the real result for THIS match if it's been played,
  //    otherwise fall back to the odds pick.
  const winnerOf = (a: string, b: string, matchNum: number): string => {
    const res = results[matchNum];
    if (res?.completed && res.winner && (res.winner === a || res.winner === b)) {
      return res.winner;
    }
    return oddsWinnerOf(a, b, matchNum);
  };
  const bracket = projectBracket({
    ranking: (g) => ranking[g],
    winnerOf,
  });

  // 5b) knockout eliminations using resolved teams
  for (const m of FIXTURES) {
    if (m.stage !== "knockout" || m.round === "Match for third place") continue;
    const res = results[m.num];
    if (!res?.completed || !res.winner) continue;
    const t1 = bracket.resolveSlot(m.team1);
    const t2 = bracket.resolveSlot(m.team2);
    const loser = res.winner === t1 ? t2 : res.winner === t2 ? t1 : null;
    if (loser && TEAM_BY_NAME[loser]) eliminated.add(loser);
  }

  // 6) confirmed slots: a KO participant is confirmed once its feeder is decided
  const confirmedSlots = new Set<string>();
  for (const g of finishedGroups) { confirmedSlots.add(ranking[g][0]); confirmedSlots.add(ranking[g][1]); }
  if (groupStageComplete) for (const t of bestThirds(ranking, tables)) confirmedSlots.add(t);
  for (const m of FIXTURES) {
    if (m.stage !== "knockout") continue;
    const res = results[m.num];
    if (res?.completed && res.winner) confirmedSlots.add(res.winner);
  }

  return {
    ranking, advanced, eliminated, finishedGroups,
    groupStageComplete, bracket, confirmedSlots,
  };
}

/** Teams in an in-progress group that can no longer reach top-2 (best-thirds ignored: conservative). */
function mathematicallyOut(
  group: string,
  tables: Record<string, GroupRow[]>,
  results: Record<number, LiveResult>,
): string[] {
  const rows = tables[group];
  if (!rows || rows.length !== 4) return [];
  const nums = GROUP_FIXTURE_NUMS[group] ?? [];
  const remaining: Record<string, number> = {};
  for (const t of TEAMS_IN_GROUP[group]) remaining[t] = 3; // each team plays 3
  for (const n of nums) {
    const r = results[n];
    if (!r?.completed) continue;
    const fx = FIXTURE_BY_NUM[n];
    if (remaining[fx.team1] != null) remaining[fx.team1]--;
    if (remaining[fx.team2] != null) remaining[fx.team2]--;
  }
  const maxPts: Record<string, number> = {};
  for (const row of rows) maxPts[row.team] = row.points + 3 * (remaining[row.team] ?? 0);
  // a team is out of top-2 if at least 2 others already have more points than its best case.
  const out: string[] = [];
  for (const row of rows) {
    const ceiling = maxPts[row.team];
    const better = rows.filter((o) => o.team !== row.team && o.points > ceiling).length;
    // conservative: only flag clear cases; best-thirds could still save a 3rd, so require
    // being beaten by 3+ teams' current points (can't even make best-3 of own group cleanly).
    if (better >= 3) out.push(row.team);
  }
  return out;
}
