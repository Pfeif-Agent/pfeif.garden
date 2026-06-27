// Shared types for the World Cup 2026 draft page.

/** A row from data/fixtures.json. Group games carry real team names in
 *  team1/team2; knockouts carry slot codes ("2A", "3A/B/C/D/F", "W91", "L101"). */
export interface Fixture {
  num: number;
  round: string;
  stage: "group" | "knockout";
  date: string; // YYYY-MM-DD
  kickoffLocal: string;
  kickoffUTC: string; // ISO, e.g. "2026-06-11T19:00Z"
  team1: string;
  team2: string;
  group: string | null;
  venue: string;
}

/** Live status of a single match, normalized from ESPN. */
export type MatchState = "pre" | "in" | "post";

export interface LiveResult {
  num: number;
  state: MatchState;
  completed: boolean;
  /** Goals for team1 / team2 (in fixtures.json order), null until known.
   *  For knockouts, fixtures order is slot codes — so the page aligns scores to the
   *  resolved teams by NAME via byTeam below; score1/score2 stay null for those. */
  score1: number | null;
  score2: number | null;
  /** Goals keyed by canonical team NAME. Set for any match ESPN gives real teams for
   *  (always for knockouts, where fixtures order can't be used). Lets the bracket place a
   *  score in the right cell once it has resolved the slot to a team. */
  byTeam?: Record<string, number>;
  /** Real participant team names ESPN reports for this fixture, in [team1-slot, team2-slot]
   *  order (home/away aligned to fixtures order for groups; ESPN home/away for knockouts).
   *  Each entry is set ONLY when ESPN has a real team there — null while ESPN still shows a
   *  placeholder ("Group L Winner", "Round of 32 3 Winner"). The knockout bracket prefers
   *  these authoritative pairings over our group-standings projection. */
  teams?: [string | null, string | null];
  /** Canonical (aliased) name of the advancing/winning side, null until decided.
   *  For group draws this stays null with both scores equal. */
  winner: string | null;
  /** ISO timestamp the result was last observed (for "updated Xm ago"). */
  asOf?: string;
}

/** One team's row in a live group table (already ordered by ESPN/our ranking). */
export interface GroupRow {
  team: string; // canonical name
  played: number;
  win: number;
  draw: number;
  loss: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  rank: number; // 1..4 within the group
}
