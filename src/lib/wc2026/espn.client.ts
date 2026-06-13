// ESPN fifa.world data client (browser). Keyless, CORS-friendly, UNOFFICIAL — so every
// fetch is wrapped, the last-good payload is cached (memory + localStorage), and callers
// must tolerate empty data. See reference/DATA-SOURCES.md.

import { ALIASES } from "../../data/draft";
import { FIXTURES } from "./fixtures";
import type { GroupRow, LiveResult, MatchState } from "./types";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const STANDINGS = "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings";
const LS_KEY = "wc2026:espn:lastgood";

/** Canonicalize an ESPN team name to our league spelling. */
export function canon(name: string): string {
  return ALIASES[name] ?? name;
}

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

function parseScoreboard(json: any, results: Record<number, LiveResult>): void {
  const events: any[] = json?.events ?? [];
  for (const ev of events) {
    const comp = ev?.competitions?.[0];
    if (!comp) continue;
    const cs: any[] = comp.competitors ?? [];
    const home = cs.find((c) => c.homeAway === "home") ?? cs[0];
    const away = cs.find((c) => c.homeAway === "away") ?? cs[1];
    if (!home || !away) continue;

    const state: MatchState = ev?.status?.type?.state ?? "pre";
    const completed: boolean = !!ev?.status?.type?.completed;
    const homeName = canon(home?.team?.displayName ?? "");
    const awayName = canon(away?.team?.displayName ?? "");

    // find our fixture num (group games by unordered pair).
    const num = GROUP_BY_PAIR.get(pairKey(homeName, awayName));
    if (num == null) continue; // knockouts handled via standings/bracket once published

    // fixtures.json stores team1/team2; align ESPN home/away to that order.
    const fx = FIXTURES.find((m) => m.num === num)!;
    const homeIsT1 = norm(homeName) === norm(fx.team1);
    const hs = home.score != null ? Number(home.score) : null;
    const as = away.score != null ? Number(away.score) : null;
    const score1 = homeIsT1 ? hs : as;
    const score2 = homeIsT1 ? as : hs;

    let winner: string | null = null;
    if (completed) {
      if (home.winner) winner = homeName;
      else if (away.winner) winner = awayName;
      else if (hs != null && as != null && hs !== as) winner = hs > as ? homeName : awayName;
      // equal score & completed => draw => winner stays null
    }

    results[num] = {
      num, state, completed,
      score1: score1 ?? null, score2: score2 ?? null,
      winner,
    };
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

/** Fetch a fresh snapshot. On total failure, returns the cached last-good (or null). */
export async function fetchLive(signal?: AbortSignal): Promise<LiveSnapshot | null> {
  const results: Record<number, LiveResult> = {};
  const groupTables: Record<string, GroupRow[]> = {};
  let okCount = 0;

  try {
    const sb = await getJSON(`${SCOREBOARD}?dates=${DATES_RANGE}`, signal);
    parseScoreboard(sb, results);
    okCount++;
  } catch { /* fall through */ }

  try {
    const st = await getJSON(STANDINGS, signal);
    parseStandings(st, groupTables);
    okCount++;
  } catch { /* fall through */ }

  if (okCount === 0) return loadCache(); // both failed → last-good

  const snap: LiveSnapshot = {
    results, groupTables,
    fetchedAt: new Date().toISOString(),
    partial: okCount < 2,
  };
  saveCache(snap);
  return snap;
}

export function cachedSnapshot(): LiveSnapshot | null {
  return loadCache();
}
