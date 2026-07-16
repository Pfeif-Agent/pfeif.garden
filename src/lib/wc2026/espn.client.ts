// ESPN fifa.world data client (browser). Keyless, CORS-friendly, UNOFFICIAL — so every
// fetch is wrapped, the last-good payload is cached (memory + localStorage), and callers
// must tolerate empty data. See reference/DATA-SOURCES.md.

import { ALIASES } from "../../data/draft";
import { FIXTURES } from "./fixtures";
import { projectBracket, oddsWinnerOf } from "./bracket";
import type { GroupRow, LiveResult, MatchState } from "./types";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const STANDINGS = "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings";
const LS_KEY = "wc2026:espn:lastgood";

/** Canonicalize an ESPN team name to our league spelling. */
export function canon(name: string): string {
  return ALIASES[name] ?? name;
}

// ESPN labels an unresolved knockout slot with a descriptive placeholder rather than a team,
// e.g. "Group L Winner", "Group J 2nd Place", "Third Place Group E/H/I/J/K", "Round of 32 3
// Winner". Treat any such label as "no real team yet" so we never mistake it for a country.
const PLACEHOLDER_RE = /\b(winner|loser|place|group|round of|runner|tbd|qualifier)\b/i;
const isRealTeam = (name: string): boolean => !!name && !PLACEHOLDER_RE.test(name);

export interface LiveSnapshot {
  results: Record<number, LiveResult>;
  groupTables: Record<string, GroupRow[]>;
  fetchedAt: string; // ISO
  partial: boolean; // true if some requests failed but we have *some* data
}

// ---- fixture lookup for matching ESPN events to our nums ---------------------

type Key = string;
const norm = (s: string) => canon(s).toLowerCase();
const pairKey = (a: string, b: string): Key => [norm(a), norm(b)].sort().join("|");

// Group games: match by the unordered team pair ALONE. Every group pairing is globally
// unique (each pair plays once), so this is reliable and — unlike date+pair — immune to the
// UTC-vs-local date skew that misfiles late-night kickoffs a day off between ESPN and fixtures.
const GROUP_BY_PAIR = new Map<Key, number>();
for (const m of FIXTURES) {
  if (m.stage === "group") GROUP_BY_PAIR.set(pairKey(m.team1, m.team2), m.num);
}

// Knockout games can't match by team-pair: our fixtures store SLOT CODES ("2A", "W91"), and
// ESPN's own teams stay placeholder strings ("Group L Winner", "Third Place Group E/H/I/J/K")
// until the feeders resolve. But every knockout has a unique, fixed kickoff instant that aligns
// 1:1 with ESPN's event date — so match KO events by kickoff time. (Normalized through
// Date.parse so any format/zone drift between the two sources still compares equal.)
const kickoffKey = (iso: string): number => Date.parse(iso);
const KO_BY_KICKOFF = new Map<number, number>();
for (const m of FIXTURES) {
  if (m.stage === "knockout") {
    const k = kickoffKey(m.kickoffUTC);
    if (!Number.isNaN(k)) KO_BY_KICKOFF.set(k, m.num);
  }
}

// ---- low-level fetch with timeout -------------------------------------------

async function getJSON(url: string, signal?: AbortSignal): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
    signal?.removeEventListener("abort", onAbort);
  }
}

// ---- parsing -----------------------------------------------------------------

/** A parsed ESPN event that couldn't be joined to a fixture in pass 1: a knockout with two
 *  real teams whose kickoff instant didn't match any fixture (ESPN's clock drifted from ours).
 *  Pass 2 re-joins these by resolved team name. */
interface UnmatchedKO {
  homeName: string;
  awayName: string;
  ev: any;
  home: any;
  away: any;
}

/** Build the LiveResult for an ESPN event we've matched to fixture `num`. */
function buildResult(ev: any, home: any, away: any, num: number): LiveResult {
  const fx = FIXTURES.find((m) => m.num === num)!;
  const state: MatchState = ev?.status?.type?.state ?? "pre";
  const completed: boolean = !!ev?.status?.type?.completed;
  const homeName = canon(home?.team?.displayName ?? "");
  const awayName = canon(away?.team?.displayName ?? "");
  const hs = home.score != null ? Number(home.score) : null;
  const as = away.score != null ? Number(away.score) : null;

  // group games: align scores to fixtures' team1/team2 (real names). knockouts: fixtures
  // order is slot codes, so leave score1/score2 null and expose goals by NAME instead —
  // the bracket places them once it knows which team filled each slot.
  const isGroup = fx.stage === "group";
  const homeIsT1 = norm(homeName) === norm(fx.team1);
  const score1 = isGroup ? (homeIsT1 ? hs : as) : null;
  const score2 = isGroup ? (homeIsT1 ? as : hs) : null;
  const byTeam: Record<string, number> = {};
  if (isRealTeam(homeName) && hs != null) byTeam[homeName] = hs;
  if (isRealTeam(awayName) && as != null) byTeam[awayName] = as;

  // Real participant teams aligned to our team1/team2 order. ESPN's home/away maps to our
  // team1/team2 slot order (verified across the R32). Each side is null while ESPN still
  // shows a placeholder, so the bracket can prefer real pairings and fall back to projection.
  const t1Name = isGroup ? (homeIsT1 ? homeName : awayName) : homeName;
  const t2Name = isGroup ? (homeIsT1 ? awayName : homeName) : awayName;
  const teams: [string | null, string | null] = [
    isRealTeam(t1Name) ? t1Name : null,
    isRealTeam(t2Name) ? t2Name : null,
  ];

  let winner: string | null = null;
  if (completed) {
    if (home.winner) winner = homeName;
    else if (away.winner) winner = awayName;
    else if (hs != null && as != null && hs !== as) winner = hs > as ? homeName : awayName;
    // equal score & completed => draw => winner stays null
    if (winner && !isRealTeam(winner)) winner = null; // never a placeholder
  }

  return {
    num, state, completed,
    score1: score1 ?? null, score2: score2 ?? null,
    byTeam: Object.keys(byTeam).length ? byTeam : undefined,
    teams: (teams[0] || teams[1]) ? teams : undefined,
    winner,
  };
}

/** Pass 1: match each ESPN event to a fixture and store its result. Group games join by
 *  unordered team pair; knockouts by exact kickoff instant. Any knockout event that DOESN'T
 *  join — because ESPN's kickoff drifted from ours (has happened: a match nudged an hour) —
 *  but shows two real teams is collected for pass 2's name-based re-join. */
function parseScoreboard(
  json: any,
  results: Record<number, LiveResult>,
  unmatchedKO: UnmatchedKO[],
): void {
  const events: any[] = json?.events ?? [];
  for (const ev of events) {
    const comp = ev?.competitions?.[0];
    if (!comp) continue;
    const cs: any[] = comp.competitors ?? [];
    const home = cs.find((c) => c.homeAway === "home") ?? cs[0];
    const away = cs.find((c) => c.homeAway === "away") ?? cs[1];
    if (!home || !away) continue;

    const homeName = canon(home?.team?.displayName ?? "");
    const awayName = canon(away?.team?.displayName ?? "");

    // Match to our fixture: group games by unordered team pair; knockouts (where our
    // team1/team2 are slot codes, not names) by exact kickoff instant. The pair lookup
    // naturally returns undefined for knockouts, so we fall through to the kickoff key.
    const num =
      GROUP_BY_PAIR.get(pairKey(homeName, awayName)) ??
      KO_BY_KICKOFF.get(kickoffKey(ev?.date ?? ""));
    if (num == null) {
      // No fixture matched. If this is a knockout with two real teams, its kickoff drifted
      // from ours — hand it to pass 2 to re-join by name (see backfillKnockoutsByName).
      if (isRealTeam(homeName) && isRealTeam(awayName)) {
        unmatchedKO.push({ homeName, awayName, ev, home, away });
      }
      continue;
    }

    results[num] = buildResult(ev, home, away, num);
  }
}

/** Pass 2: re-join knockout events pass 1 dropped, by RESOLVED team name instead of kickoff
 *  time. We can only know which teams belong in slot-coded KO fixtures once earlier results
 *  are in, so we build a bracket projection from pass 1's results and use it to resolve each
 *  still-unfilled knockout fixture's two slots. A dropped event whose real teams equal a
 *  fixture's resolved pair is adopted for that fixture — no dependency on ESPN's clock.
 *  Group games and knockouts that already joined by time are untouched. */
function backfillKnockoutsByName(
  results: Record<number, LiveResult>,
  unmatchedKO: UnmatchedKO[],
): void {
  if (unmatchedKO.length === 0) return;

  // Bracket projection seeded with the winners we DO have; unknown feeders fall back to odds
  // so downstream slots still resolve to a concrete team where the feeder is decided.
  const bracket = projectBracket({
    winnerOf: (a, b, num) => {
      const r = results[num];
      if (r?.completed && r.winner) return r.winner;
      return oddsWinnerOf(a, b, num);
    },
  });

  const byPair = new Map<Key, UnmatchedKO>();
  for (const c of unmatchedKO) byPair.set(pairKey(c.homeName, c.awayName), c);

  for (const m of FIXTURES) {
    if (m.stage !== "knockout" || results[m.num]) continue; // already joined in pass 1
    const t1 = bracket.resolveSlot(m.team1);
    const t2 = bracket.resolveSlot(m.team2);
    if (!isRealTeam(t1) || !isRealTeam(t2)) continue; // slots not resolved to real teams yet
    const cand = byPair.get(pairKey(t1, t2));
    if (!cand) continue;
    results[m.num] = buildResult(cand.ev, cand.home, cand.away, m.num);
  }
}

function parseStandings(json: any, tables: Record<string, GroupRow[]>): void {
  // ESPN standings come as groups (children) each with a standings.entries[] list.
  const groups: any[] = json?.children ?? json?.groups ?? [];
  for (const g of groups) {
    const letter = deriveGroupLetter(g?.name ?? g?.abbreviation ?? "");
    if (!letter) continue;
    const entries: any[] = g?.standings?.entries ?? [];
    const rows: GroupRow[] = entries.map((e) => {
      const stats: Record<string, number> = {};
      for (const s of e?.stats ?? []) {
        if (s?.name) stats[s.name] = Number(s.value ?? 0);
      }
      return {
        team: canon(e?.team?.displayName ?? ""),
        played: stats.gamesPlayed ?? 0,
        win: stats.wins ?? 0,
        draw: stats.ties ?? stats.draws ?? 0,
        loss: stats.losses ?? 0,
        gf: stats.pointsFor ?? stats.goalsFor ?? 0,
        ga: stats.pointsAgainst ?? stats.goalsAgainst ?? 0,
        gd: stats.pointDifferential ?? stats.goalDifferential ?? 0,
        points: stats.points ?? 0,
        rank: stats.rank ?? 0,
      };
    });
    // order by ESPN rank when present, else Pts->GD->GF.
    rows.sort((a, b) =>
      (a.rank && b.rank ? a.rank - b.rank : 0) ||
      b.points - a.points || b.gd - a.gd || b.gf - a.gf);
    rows.forEach((r, i) => { if (!r.rank) r.rank = i + 1; });
    if (rows.length) tables[letter] = rows;
  }
}

function deriveGroupLetter(name: string): string | null {
  const m = /group\s+([A-L])/i.exec(name);
  return m ? m[1].toUpperCase() : null;
}

// ---- caching -----------------------------------------------------------------

let lastGood: LiveSnapshot | null = null;

function loadCache(): LiveSnapshot | null {
  if (lastGood) return lastGood;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) lastGood = JSON.parse(raw);
  } catch { /* ignore */ }
  return lastGood;
}

function saveCache(snap: LiveSnapshot): void {
  lastGood = snap;
  try { localStorage.setItem(LS_KEY, JSON.stringify(snap)); } catch { /* quota/SSR */ }
}

// ---- public API --------------------------------------------------------------

// the whole tournament window, so one scoreboard range covers every stage.
const DATES_RANGE = "20260611-20260719";

// ESPN caps the scoreboard at 100 events by DEFAULT and silently truncates the TAIL — with 104
// matches that drops the semifinals onward, and no widening of DATES_RANGE helps (the cap is on
// event count, not the window). Ask for more than the tournament can ever contain.
const EVENT_LIMIT = 200;

/** Fetch a fresh snapshot. On total failure, returns the cached last-good (or null). */
export async function fetchLive(signal?: AbortSignal): Promise<LiveSnapshot | null> {
  const results: Record<number, LiveResult> = {};
  const groupTables: Record<string, GroupRow[]> = {};
  let okCount = 0;
  // short payload = ESPN dropped events on us; treat the snapshot as partial rather than
  // letting the odds projection quietly stand in for matches that were actually played.
  let truncated = false;

  try {
    const sb = await getJSON(`${SCOREBOARD}?dates=${DATES_RANGE}&limit=${EVENT_LIMIT}`, signal);
    const unmatchedKO: UnmatchedKO[] = [];
    parseScoreboard(sb, results, unmatchedKO);   // pass 1: by pair / kickoff instant
    backfillKnockoutsByName(results, unmatchedKO); // pass 2: re-join drifted KO by team name
    truncated = (sb?.events?.length ?? 0) < FIXTURES.length;
    okCount++;
  } catch { /* fall through */ }

  try {
    const st = await getJSON(STANDINGS, signal);
    parseStandings(st, groupTables);
    okCount++;
  } catch { /* fall through */ }

  if (okCount === 0) return loadCache(); // both failed → last-good

  if (truncated) {
    console.warn(
      `[wc2026] scoreboard returned fewer than ${FIXTURES.length} events — results are ` +
      `incomplete and unplayed-looking matches may just be missing. Check the ESPN event cap.`,
    );
  }

  const snap: LiveSnapshot = {
    results, groupTables,
    fetchedAt: new Date().toISOString(),
    partial: okCount < 2 || truncated,
  };
  saveCache(snap);
  return snap;
}

export function cachedSnapshot(): LiveSnapshot | null {
  return loadCache();
}
