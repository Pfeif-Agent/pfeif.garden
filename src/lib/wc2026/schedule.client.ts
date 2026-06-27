// Jump-to-today: scrolls the schedule to the first day on/after today.
//
// The schedule is a long chronological list (104 fixtures). Each .sched-day carries a
// data-date (sortable CT ISO date, "2026-06-11"). At view time we find the first day whose
// date >= today (CT) and scroll to it, offsetting for the sticky label bar. Progressive
// enhancement: the button ships [hidden] and is only revealed once we've confirmed there's
// a target day to jump to (with JS off it stays hidden — nothing to script).

/** Today's calendar date in CT as a sortable "YYYY-MM-DD" string, to match data-date. */
function todayCtIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export function initSchedule(): void {
  const btn = document.querySelector<HTMLButtonElement>("[data-jump-today]");
  if (!btn) return;

  const days = Array.from(document.querySelectorAll<HTMLElement>(".sched-day[data-date]"));
  if (!days.length) return;

  const findTarget = (): HTMLElement | null => {
    const today = todayCtIso();
    // days are in chronological order; first one whose date >= today is "today or next up".
    return days.find((d) => (d.dataset.date ?? "") >= today) ?? null;
  };

  // Only reveal the button if there's somewhere to jump (a today-or-later day exists).
  if (!findTarget()) return;
  btn.hidden = false;

  btn.addEventListener("click", () => {
    const target = findTarget();
    if (!target) return;
    // offset for the sticky label bar so the day heading isn't hidden under it.
    const labelBar = document.querySelector<HTMLElement>(".sched-labels");
    const offset = (labelBar?.offsetHeight ?? 0) + 12;
    const y = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: y, behavior: "smooth" });
  });
}
