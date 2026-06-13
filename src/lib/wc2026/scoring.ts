// Apply the "B+2" scoring ladder to live results. See reference/SCORING.md.
// Points go to whoever drafted the team; a team accumulates across the tournament.

import { SCORING, TEAMS, MANAGERS, TEAM_BY_NAME } from "../../data/draft";
import { FIXTURE_BY_NUM } from "./fixtures";
import type { GroupRow, LiveResult } from "./types";

/** Points awarded for *winning* a knockout match, by round name in fixtures.json. */
const KO_WIN_POINTS: Record<string, number> = {
  "Round of 32": SCORING.winR32,
  "Round of 16": SCORING.winR16,
  "Quarter-final": SCORING.winQF,
  "Semi-final": SCORING.winSF,
  Final: SCORING.winFinal,
  "Match for third place": SCORING.thirdPlacePlayoff, // 0
};

export interface PointEvent {
  points: number;
  label: string; // e.g. "Group win", "Advanced (R32)", "Won R16"
}

export interface TeamScore {
  team: string;
  manager: number;
  points: number;
  events: PointEvent[];
  /** Furthest stage reached/known, for the breakdown ("Group", "R32", … "Champion"). */
  stage: string;
  eliminated: boolean;
}

export interface ManagerScore {
  manager: number;
  name: string;
  points: number;
  teams: TeamScore[];
}

export interface ScoreInputs {
  /** Live group tables keyed by group letter (ordered rows). */
  groupTables: Record<string, GroupRow[]>;
  /** Live match results keyed by fixture num. */
  results: Record<number, LiveResult>;
  /** Set of canonical team names confirmed advanced to the R32 (top-2 or best-8 third). */
  advanced: Set<string>;
  /** Set of canonical team names eliminated. */
  eliminated: Set<string>;
}

/** Furthest round a team reached, derived from completed knockout wins. */
function stageOf(team: string, results: Record<number, LiveResult>, advanced: Set<string>): string {
  let best = advanced.has(team) ? "R32" : "Group";
  const order = ["R32", "R16", "QF", "SF", "Final", "Champion"];
  const wonRoundLabel: Record<string, string> = {
    "Round of 32": "R16",
    "Round of 16": "QF",
    "Quarter-final": "SF",
    "Semi-final": "Final",
    Final: "Champion",
  };
  for (const [num, r] of Object.entries(results)) {
    if (!r.completed || r.winner !== team) continue;
    const fx = FIXTURE_BY_NUM[Number(num)];
    if (!fx || fx.stage !== "knockout") continue;
    const reached = wonRoundLabel[fx.round];
    if (reached && order.indexOf(reached) > order.indexOf(best)) best = reached;
  }
  return best;
}

/** Compute per-team and per-manager scores from live state. */
export function computeScores(inputs: ScoreInputs): {
  managers: ManagerScore[];
  teamScores: Record<string, TeamScore>;
} {
  const teamScores: Record<string, TeamScore> = {};
  for (const t of TEAMS) {
    teamScores[t.name] = {
      team: t.name,
      manager: t.manager,
      points: 0,
      events: [],
      stage: "Group",
      eliminated: inputs.eliminated.has(t.name),
    };
  }

  const add = (team: string, points: number, label: string) => {
    const ts = teamScores[team];
    if (!ts || points === 0) return;
    ts.points += points;
    ts.events.push({ points, label });
  };

  // 1) Group stage: +3 win / +1 draw per completed group game.
  for (const r of Object.values(inputs.results)) {
    if (!r.completed) continue;
    const fx = FIXTURE_BY_NUM[r.num];
    if (!fx || fx.stage !== "group") continue;
    const t1 = TEAM_BY_NAME[fx.team1] ? fx.team1 : null;
    const t2 = TEAM_BY_NAME[fx.team2] ? fx.team2 : null;
    if (r.winner) {
      add(r.winner, SCORING.groupWin, "Group win");
    } else if (r.score1 != null && r.score2 != null && r.score1 === r.score2) {
      if (t1) add(t1, SCORING.groupDraw, "Group draw");
      if (t2) add(t2, SCORING.groupDraw, "Group draw");
    }
  }

  // 2) Advance bonus: +2 once confirmed into the R32.
  for (const team of inputs.advanced) {
    add(team, SCORING.advanceToR32, "Advanced (R32)");
    if (teamScores[team]) teamScores[team].stage = "R32";
  }

  // 3) Knockout wins: round points to the advancing side.
  for (const r of Object.values(inputs.results)) {
    if (!r.completed || !r.winner) continue;
    const fx = FIXTURE_BY_NUM[r.num];
    if (!fx || fx.stage !== "knockout") continue;
    const pts = KO_WIN_POINTS[fx.round] ?? 0;
    add(r.winner, pts, `Won ${fx.round}`);
  }

  // 4) Stage labels + eliminated flag.
  for (const ts of Object.values(teamScores)) {
    ts.stage = stageOf(ts.team, inputs.results, inputs.advanced);
    ts.eliminated = inputs.eliminated.has(ts.team);
  }

  // 5) Aggregate to managers.
  const managers: ManagerScore[] = MANAGERS.map((m, i) => {
    const teams = TEAMS.filter((t) => t.manager === i)
      .map((t) => teamScores[t.name])
      .sort((a, b) => b.points - a.points || a.team.localeCompare(b.team));
    return {
      manager: i,
      name: m.name,
      points: teams.reduce((s, t) => s + t.points, 0),
      teams,
    };
  }).sort((a, b) => b.points - a.points);

  return { managers, teamScores };
}
