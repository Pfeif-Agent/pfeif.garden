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
  const todayKey = new Date().toISOString().slice(0, 10);
  document.querySelectorAll<HTMLElement>('.match[data-match]').forEach((row) => {
    const num = Number(row.dataset.match);
    const fx = FIXTURE_BY_NUM[num];
    if (!fx) return;
    const res = snap.results[num];

    // resolve knockout teams from the live bracket as they're determined.
    if (fx.stage === "knockout") {
      const t1 = state.bracket.resolveSlot(fx.team1);
      const t2 = state.bracket.resolveSlot(fx.team2);
      const confirmed = state.confirmedSlots.has(t1) && state.confirmedSlots.has(t2);
      setTeamCell(row.querySelectorAll<HTMLElement>(".tcell")[0], t1);
      setTeamCell(row.querySelectorAll<HTMLElement>(".tcell")[1], t2);
      row.classList.toggle("pred", !confirmed);
    }

    // today highlight (by the row's kickoff date in viewer zone)
    const k = row.querySelector<HTMLElement>(".mt-time")?.dataset.kickoff;
    if (k) row.classList.toggle("today", new Date(k).toISOString().slice(0, 10) === todayKey);

    if (!res) return;
    // status + score
    let scoreEl = row.querySelector<HTMLElement>(".sc");
    if (res.state !== "pre" && res.score1 != null && res.score2 != null) {
      if (!scoreEl) {
        scoreEl = document.createElement("span");
        scoreEl.className = "sc";
        row.querySelector(".vs")?.replaceWith(scoreEl);
      }
      scoreEl.textContent = `${res.score1}–${res.score2}`;
    }
    // live dot
    row.querySelector(".live-dot")?.remove();
    if (res.state === "in") {
      const dot = document.createElement("span");
      dot.className = "live-dot";
      dot.setAttribute("aria-label", "in progress");
      row.prepend(dot);
    }
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
  const useRealKO = state.groupStageComplete; // after groups, ESPN owns the R32 (we still resolve via bracket)
  for (const mu of document.querySelectorAll<HTMLElement>(".matchup[data-match]")) {
    const num = Number(mu.dataset.match);
    const fx = FIXTURE_BY_NUM[num];
    if (!fx) continue;
    const t1 = state.bracket.resolveSlot(fx.team1);
    const t2 = state.bracket.resolveSlot(fx.team2);
    const teams = [t1, t2];
    const res = snap.results[num];
    const winner = fx.round === "Match for third place"
      ? null
      : (res?.completed ? res.winner : state.bracket.winnerOfMatch(num));

    const rows = mu.querySelectorAll<HTMLElement>(".mu-team");
    rows.forEach((r, i) => {
      const team = teams[i];
      setMuTeam(r, team, winner === team);
      // live score on knockout cells
      let sc = r.querySelector<HTMLElement>(".sc");
      const s = i === 0 ? res?.score1 : res?.score2;
      if (sc) {
        if (res && res.state !== "pre" && s != null) { sc.textContent = String(s); sc.hidden = false; }
        else sc.hidden = true;
      }
    });

    const confirmed = (res?.completed === true) ||
      (state.confirmedSlots.has(t1) && state.confirmedSlots.has(t2) && fx.round === "Round of 32" && useRealKO);
    mu.classList.toggle("confirmed", confirmed);
  }

  // champion callout
  const champ = document.querySelector<HTMLElement>("[data-champ]");
  if (champ) {
    const finalRes = snap.results[104];
    const champName = finalRes?.completed && finalRes.winner ? finalRes.winner : state.bracket.champion;
    const label = champ.querySelector<HTMLElement>("[data-champ-label]");
    const name = champ.querySelector<HTMLElement>("[data-champ-name]");
    const cdot = champ.querySelector<HTMLElement>(".cdot");
    if (label) label.textContent = finalRes?.completed ? "Champion" : "Projected champion";
    if (name) name.textContent = champName;
    if (cdot) cdot.style.background = colorFor(champName);
  }
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
      li.classList.toggle("adv-pos", idx < 2);
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

function patchStandings(scores: ReturnType<typeof computeScores>): void {
  const note = document.querySelector<HTMLElement>("[data-standings-note]");
  const anyPoints = scores.managers.some((m) => m.points > 0);
  if (note) note.hidden = anyPoints;

  // leaderboard (re-rank rows by points)
  const lead = document.querySelector<HTMLElement>("[data-leaderboard]");
  if (lead) {
    scores.managers.forEach((m, rank) => {
      const rowEl = lead.querySelector<HTMLElement>(`.lrow[data-mgr="${m.manager}"]`);
      if (!rowEl) return;
      lead.appendChild(rowEl); // reorder by current standing
      rowEl.querySelector<HTMLElement>(".lrank")!.textContent = String(rank + 1);
      rowEl.querySelector<HTMLElement>("[data-mgr-pts]")!.textContent = String(m.points);
      const alive = m.teams.filter((t) => !t.eliminated).length;
      const aliveEl = rowEl.querySelector<HTMLElement>("[data-alive]");
      if (aliveEl) aliveEl.textContent = `${alive}/${m.teams.length} alive`;
    });
  }

  // per-manager breakdown cards
  for (const m of scores.managers) {
    const card = document.querySelector<HTMLElement>(`[data-mgr-card="${m.manager}"]`);
    if (!card) continue;
    card.querySelector<HTMLElement>("[data-mgr-pts]")!.textContent = String(m.points);
    // reorder team rows by points
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
  }
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
