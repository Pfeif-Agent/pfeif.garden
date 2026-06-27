// Phase 2 live layer: fetch ESPN, derive state, score it, and patch the static DOM.
// Progressive enhancement — every step is guarded; if anything fails the static page
// stands and a quiet status note explains. See ./reference/*.md.

import { fetchLive, cachedSnapshot } from "./espn.client";
import { deriveLiveState } from "./livestate";
import { computeScores } from "./scoring";
import { FIXTURE_BY_NUM } from "./fixtures";
import { MANAGERS, TEAM_BY_NAME } from "../../data/draft";
import type { LiveSnapshot } from "./espn.client";

const POLL_MS = 75_000;

// "Today" is judged in US Central — the same zone the schedule groups days by — so a match's
// highlight matches the day bucket it sits under. (Judging in UTC misfiled late West-Coast
// kickoffs, which roll past midnight UTC but are still "tonight" in CT.) en-CA yields YYYY-MM-DD.
const CT_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
});
const ctDateKey = (d: Date): string => CT_DAY.format(d);

let timer: number | null = null;
let consecutiveErrors = 0;

export function initLive(): void {
  // re-localize kickoff times to the viewer's zone immediately (no network needed).
  localizeKickoffs();

  // first paint with any cached snapshot, then fetch fresh.
  const cached = cachedSnapshot();
  if (cached) applySnapshot(cached, true);
  void refresh();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleNext(2_000); // catch up quickly when the tab regains focus
    } else if (timer != null) {
      clearTimeout(timer); timer = null;
    }
  });
}

function scheduleNext(ms = POLL_MS): void {
  if (document.visibilityState !== "visible") return;
  if (timer != null) clearTimeout(timer);
  timer = window.setTimeout(() => void refresh(), ms);
}

async function refresh(): Promise<void> {
  try {
    const snap = await fetchLive();
    if (snap) {
      consecutiveErrors = 0;
      applySnapshot(snap, false);
    } else {
      consecutiveErrors++;
      markOffline();
    }
  } catch {
    consecutiveErrors++;
    markOffline();
  } finally {
    // exponential-ish backoff on repeated failure, capped.
    const backoff = consecutiveErrors > 0 ? Math.min(POLL_MS * 2 ** consecutiveErrors, 600_000) : POLL_MS;
    scheduleNext(backoff);
  }
}

// ---- apply a snapshot to the DOM --------------------------------------------

function applySnapshot(snap: LiveSnapshot, fromCache: boolean): void {
  let state, scores;
  try {
    state = deriveLiveState(snap.results, snap.groupTables);
    scores = computeScores({
      groupTables: snap.groupTables,
      results: snap.results,
      advanced: state.advanced,
      eliminated: state.eliminated,
    });
  } catch (e) {
    // derivation failed — leave the static page untouched, note it quietly.
    markOffline();
    return;
  }

  try { patchUpcoming(snap, state); } catch { /* non-fatal */ }
  try { patchBracket(snap, state); } catch { /* non-fatal */ }
  try { patchGroups(snap, state); } catch { /* non-fatal */ }
  try { patchStandings(scores); } catch { /* non-fatal */ }
  try { patchEliminations(state.eliminated); } catch { /* non-fatal */ }

  setStatus(snap.fetchedAt, fromCache || snap.partial);
}

// ---- 2d. Upcoming: live scores/status, real KO teams, today highlight -------

function patchUpcoming(snap: LiveSnapshot, state: ReturnType<typeof deriveLiveState>): void {
  const todayKey = ctDateKey(new Date());
  document.querySelectorAll<HTMLElement>('.match[data-match]').forEach((row) => {
    const num = Number(row.dataset.match);
    const fx = FIXTURE_BY_NUM[num];
    if (!fx) return;
    const res = snap.results[num];

    // resolve knockout teams from the live bracket as they're determined. The R32 pairing
    // shows its projected teams (group seeds + best-thirds); later rounds depend on results
    // we don't predict, so they stay "TBD" until their feeder is actually decided.
    let confirmed = true;
    let koT1 = "", koT2 = "";
    if (fx.stage === "knockout") {
      koT1 = state.bracket.resolveSlot(fx.team1);
      koT2 = state.bracket.resolveSlot(fx.team2);
      // Prefer ESPN's real participant; else for a W/L-fed slot, the team only once that feeder
      // has been PLAYED (else "TBD"); else (R32 seed not yet set by ESPN) the projected seed.
      // Same priority as the bracket — keeps the schedule and bracket telling one story.
      const show = (slotCode: string, projected: string, idx: 0 | 1): string => {
        const espnTeam = snap.results[num]?.teams?.[idx];
        if (espnTeam) return espnTeam;
        const wl = /^[WL](\d+)$/.exec(String(slotCode));
        if (wl) return snap.results[Number(wl[1])]?.completed ? projected : "TBD";
        return projected;
      };
      koT1 = show(fx.team1, koT1, 0);
      koT2 = show(fx.team2, koT2, 1);
      confirmed = koT1 !== "TBD" && koT2 !== "TBD";
      setTeamCell(row.querySelectorAll<HTMLElement>(".tcell")[0], koT1);
      setTeamCell(row.querySelectorAll<HTMLElement>(".tcell")[1], koT2);
      row.classList.toggle("pred", !confirmed);
    }

    const k = row.querySelector<HTMLElement>(".mt-time")?.dataset.kickoff;
    const isToday = !!k && ctDateKey(new Date(k)) === todayKey;

    // five-state machine: live > done > today > tbd > future.
    let stateName: string;
    if (res?.state === "in") stateName = "live";
    else if (res?.completed) stateName = "done";
    else if (fx.stage === "knockout" && !confirmed) stateName = "tbd";
    else if (isToday) stateName = "today";
    else stateName = "future";
    row.dataset.state = stateName;

    // status + score, written into the persistent .sc-slot (replaces the old "v").
    // group games carry score1/score2 (fixtures order); knockouts carry goals by team NAME,
    // so align them to this row's resolved team1/team2 (koT1/koT2).
    const sc1 = fx.stage === "knockout" ? res?.byTeam?.[koT1] ?? null : res?.score1 ?? null;
    const sc2 = fx.stage === "knockout" ? res?.byTeam?.[koT2] ?? null : res?.score2 ?? null;
    const slot = row.querySelector<HTMLElement>(".sc-slot");
    if (slot && res && res.state !== "pre" && sc1 != null && sc2 != null) {
      let scoreEl = slot.querySelector<HTMLElement>(".sc");
      if (!scoreEl) {
        scoreEl = document.createElement("span");
        scoreEl.className = "sc";
        slot.replaceChildren(scoreEl); // drops the "–" placeholder
      }
      scoreEl.textContent = `${sc1}–${sc2}`;
      const status = res.completed ? ", final" : res.state === "in" ? ", in progress" : "";
      scoreEl.setAttribute("aria-label", `${sc1} to ${sc2}${status}`);
    }

    // winner emphasis on completed matches (mirrors the bracket's .adv treatment).
    const cells = row.querySelectorAll<HTMLElement>(".tcell");
    cells.forEach((c) => c.classList.remove("win"));
    if (res?.completed && res.winner) {
      cells.forEach((c) => {
        if (c.querySelector<HTMLElement>(".tn")?.dataset.team === res.winner) c.classList.add("win");
      });
    }

    // live games are signalled by the grass accent bar + green kickoff time (state-driven CSS)
    // and the score's "in progress" aria-label — no separate orb.
  });
}

function setTeamCell(cell: HTMLElement | undefined, team: string): void {
  if (!cell) return;
  const tn = cell.querySelector<HTMLElement>(".tn");
  const dot = cell.querySelector<HTMLElement>(".dot");
  if (tn && tn.dataset.team !== team) {
    tn.dataset.team = team;
    tn.firstChild && (tn.firstChild.textContent = team);
    if (!tn.firstChild) tn.textContent = team;
    const mgrName = ownerName(team);
    let sr = tn.querySelector<HTMLElement>(".visually-hidden");
    if (mgrName) {
      if (!sr) { sr = document.createElement("span"); sr.className = "visually-hidden"; tn.appendChild(sr); }
      sr.textContent = ` (drafted by ${mgrName})`;
    } else if (sr) sr.remove();
  }
  if (dot) dot.style.background = colorFor(team);
}

// ---- 2e. Bracket: confirmed vs predicted, live advancers, champion ----------

function patchBracket(snap: LiveSnapshot, state: ReturnType<typeof deriveLiveState>): void {
  for (const mu of document.querySelectorAll<HTMLElement>(".matchup[data-match]")) {
    const num = Number(mu.dataset.match);
    const fx = FIXTURE_BY_NUM[num];
    if (!fx) continue;
    const res = snap.results[num];
    const t1 = state.bracket.resolveSlot(fx.team1);
    const t2 = state.bracket.resolveSlot(fx.team2);
    // Resolve each slot to what we SHOW, and whether it's a SECURED fact (solid) or just a
    // projection (dimmed). Priority:
    //   1. ESPN's real participant (res.teams[i]) — authoritative & secured. ESPN fills the
    //      R32 pairing as groups finalize; until then that side is a placeholder (null).
    //   2. else for an R16+ slot fed by W/L code: the real team only once that feeder match
    //      has been PLAYED (else "TBD"); we never show an odds-projected knockout winner.
    //   3. else (R32 group-seed slot, ESPN not yet resolved): our projected seed, dimmed.
    const resolveCell = (slotCode: string, projected: string, idx: 0 | 1):
      { team: string; secured: boolean } => {
      const espnTeam = res?.teams?.[idx];
      if (espnTeam) return { team: espnTeam, secured: true };
      const wl = /^[WL](\d+)$/.exec(String(slotCode));
      if (wl) {
        return snap.results[Number(wl[1])]?.completed
          ? { team: projected, secured: true }
          : { team: "TBD", secured: false };
      }
      return { team: projected, secured: false }; // R32 seed, still projected
    };
    const cells = [resolveCell(fx.team1, t1, 0), resolveCell(fx.team2, t2, 1)];
    // winner emphasis only from a real completed result — never a projection.
    const winner = res?.completed ? res.winner : null;

    const rows = mu.querySelectorAll<HTMLElement>(".mu-team");
    rows.forEach((r, i) => {
      const { team, secured } = cells[i];
      setMuTeam(r, team, winner != null && winner === team);
      r.classList.toggle("tbd", team === "TBD");
      // projected: a real team is shown but its slot isn't a locked fact yet. Dim it 50%;
      // it goes solid once ESPN/a result secures it.
      r.classList.toggle("projected", team !== "TBD" && !secured);
      // live score on knockout cells. Knockout results carry goals BY TEAM NAME (fixtures
      // order is slot codes), so look this cell's resolved team up in byTeam; fall back to
      // the positional score1/score2 if present.
      let sc = r.querySelector<HTMLElement>(".sc");
      const s = res?.byTeam?.[team] ?? (i === 0 ? res?.score1 : res?.score2);
      if (sc) {
        if (res && res.state !== "pre" && s != null) { sc.textContent = String(s); sc.hidden = false; }
        else sc.hidden = true;
      }
    });

    // solid matchup border once both participants are secured facts (or the game's been played).
    const confirmed = res?.completed === true || (cells[0].secured && cells[1].secured);
    mu.classList.toggle("confirmed", confirmed);
  }
  // No champion callout: we don't project a winner. The Final fills in from real results.
}

function setMuTeam(row: HTMLElement, team: string, isWin: boolean): void {
  const tn = row.querySelector<HTMLElement>(".tn");
  const dot = row.querySelector<HTMLElement>(".dot");
  if (tn) {
    row.dataset.team = team;
    // preserve the screen-reader owner suffix
    const sr = tn.querySelector<HTMLElement>(".visually-hidden");
    tn.childNodes[0] && (tn.childNodes[0].textContent = team);
    const mgrName = ownerName(team);
    if (mgrName) {
      const s = sr ?? Object.assign(document.createElement("span"), { className: "visually-hidden" });
      s.textContent = ` (drafted by ${mgrName})`;
      if (!sr) tn.appendChild(s);
    } else if (sr) sr.remove();
  }
  if (dot) dot.style.background = colorFor(team);
  row.classList.toggle("win", isWin);
  let adv = row.querySelector<HTMLElement>(".adv");
  if (isWin && !adv) {
    adv = document.createElement("span");
    adv.className = "adv";
    adv.setAttribute("aria-label", "advancing");
    adv.textContent = "▸";
    row.appendChild(adv);
  } else if (!isWin && adv) adv.remove();
}

// ---- 2c. Group tables: live W/D/L/GD/Pts, advance/eliminated picture --------

function patchGroups(snap: LiveSnapshot, state: ReturnType<typeof deriveLiveState>): void {
  // currently-projected best-8 thirds (cross-group, live-ranked) — greens their pos-number
  // just like top-2, since they're currently projected to advance. Not gated on the group
  // stage being complete: state.bracket re-ranks the thirds live every snapshot.
  const projThirds = new Set(state.bracket.qualifyingThirds);
  for (const card of document.querySelectorAll<HTMLElement>(".grp[data-group]")) {
    const g = card.dataset.group!;
    const table = snap.groupTables[g];
    const order = state.ranking[g];
    if (!order) continue;
    const lis = Array.from(card.querySelectorAll<HTMLElement>("li[data-team-row]"));
    // reorder rows to live ranking
    const byTeam = new Map(lis.map((li) => [li.dataset.teamRow!, li]));
    const ul = card.querySelector("ul");
    order.forEach((team, idx) => {
      const li = byTeam.get(team);
      if (!li || !ul) return;
      ul.appendChild(li);
      const posEl = li.querySelector<HTMLElement>("[data-pos-label]");
      if (posEl) posEl.textContent = String(idx + 1);
      li.classList.toggle("adv", state.advanced.has(team));
      // green pos-number: top-2 (positional) or a 3rd currently inside the best-8 cutoff.
      li.classList.toggle("adv-pos", idx < 2 || projThirds.has(team));
      // stats chip
      const row = table?.find((r) => r.team === team);
      const stat = li.querySelector<HTMLElement>("[data-group-stat]");
      if (stat && row) {
        stat.hidden = false;
        stat.textContent = `${row.win}-${row.draw}-${row.loss} · ${row.points}pt`;
      }
    });
  }
}

// ---- 2b. Standings: per-team points, manager leaderboard --------------------

const MEDAL = ["gold", "silver", "bronze"];

function patchStandings(scores: ReturnType<typeof computeScores>): void {
  const note = document.querySelector<HTMLElement>("[data-standings-note]");
  const anyPoints = scores.managers.some((m) => m.points > 0);
  if (note) note.hidden = anyPoints;

  // scores.managers arrives sorted by current standing — re-rank the merged cards,
  // apply medal tint by live rank, and update each card's header + roster rows.
  const grid = document.querySelector<HTMLElement>("[data-leaderboard]");
  scores.managers.forEach((m, rank) => {
    const card = document.querySelector<HTMLElement>(`[data-mgr-card="${m.manager}"]`);
    if (!card) return;
    if (grid) grid.appendChild(card); // reorder by current standing

    // rank + medal class (only once points actually diverge — pre-tournament stays neutral)
    const rankEl = card.querySelector<HTMLElement>("[data-rank]");
    if (rankEl) rankEl.textContent = String(rank + 1);
    card.classList.remove("medal", "gold", "silver", "bronze");
    if (anyPoints && rank < 3) card.classList.add("medal", MEDAL[rank]);

    card.querySelector<HTMLElement>("[data-mgr-pts]")!.textContent = String(m.points);

    const alive = m.teams.filter((t) => !t.eliminated).length;
    const aliveEl = card.querySelector<HTMLElement>("[data-alive]");
    if (aliveEl) {
      aliveEl.textContent = `${alive}/${m.teams.length} alive`;
      aliveEl.classList.toggle("out", alive < m.teams.length);
    }

    // reorder roster rows by points
    const ol = card.querySelector("ol");
    for (const ts of m.teams) {
      const li = card.querySelector<HTMLElement>(`li[data-team-row="${cssEscape(ts.team)}"]`);
      if (!li) continue;
      ol?.appendChild(li);
      li.querySelector<HTMLElement>("[data-team-pts]")!.textContent = String(ts.points);
      const stage = li.querySelector<HTMLElement>("[data-stage-label]");
      if (stage) stage.textContent = ts.stage;
      li.classList.toggle("elim", ts.eliminated);
    }
  });
}

// ---- eliminations everywhere ------------------------------------------------

function patchEliminations(eliminated: Set<string>): void {
  document.querySelectorAll<HTMLElement>("[data-team]").forEach((el) => {
    const team = el.dataset.team!;
    el.classList.toggle("elim", eliminated.has(team));
  });
  // roster/board/group rows too (the .tn carries data-team; class on the .tn is enough,
  // but also tag the row for stronger styling hooks).
  document.querySelectorAll<HTMLElement>("[data-team-row]").forEach((el) => {
    el.classList.toggle("elim", eliminated.has(el.dataset.teamRow!));
  });
}

// ---- status note ------------------------------------------------------------

function setStatus(fetchedAt: string, stale: boolean): void {
  const el = document.querySelector<HTMLElement>("[data-live-status]");
  if (!el) return;
  const mins = Math.max(0, Math.round((Date.now() - new Date(fetchedAt).getTime()) / 60000));
  const ago = mins === 0 ? "just now" : `${mins}m ago`;
  el.textContent = stale ? `Live data (cached) — updated ${ago}` : `Live — updated ${ago}`;
  el.classList.toggle("offline", stale);
}

function markOffline(): void {
  const el = document.querySelector<HTMLElement>("[data-live-status]");
  const cached = cachedSnapshot();
  if (!el) return;
  if (cached) {
    setStatus(cached.fetchedAt, true);
  } else {
    el.textContent = "Couldn't reach live data — showing the projected bracket";
    el.classList.add("offline");
  }
}

// ---- timezone localization of static kickoff times --------------------------

function localizeKickoffs(): void {
  const tf = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
  document.querySelectorAll<HTMLElement>(".mt-time[data-kickoff]").forEach((el) => {
    const iso = el.dataset.kickoff;
    if (!iso) return;
    try { el.textContent = tf.format(new Date(iso)); } catch { /* keep server value */ }
  });
}

// ---- small utils ------------------------------------------------------------

function colorFor(team: string): string {
  const t = TEAM_BY_NAME[team];
  return t ? managerColor(t.manager) : "#66716B";
}
function ownerName(team: string): string | null {
  const t = TEAM_BY_NAME[team];
  return t ? managerName(t.manager) : null;
}
const managerColor = (i: number) => MANAGERS[i]?.color ?? "#66716B";
const managerName = (i: number) => MANAGERS[i]?.name ?? null;

function cssEscape(s: string): string {
  // used inside an already-quoted attribute selector value, so escape quotes/backslashes
  return s.replace(/(["\\])/g, "\\$1");
}
