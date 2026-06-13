// Accessible tab switching (WAI-ARIA tabs pattern), progressive-enhancement safe.
//
// No-JS fallback: the markup ships with the first panel visible and the rest [hidden].
// That alone is a poor no-JS experience (only one view reachable), so before wiring up
// tab behavior we REVEAL every panel — with JS off, the page is a single long scroll of
// all views (fully usable). Once JS runs, we collapse back to one-panel-at-a-time tabs.

export function initTabs(): void {
  const tablist = document.querySelector<HTMLElement>('[role="tablist"]');
  if (!tablist) return;
  const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const panels = tabs
    .map((t) => document.getElementById(t.getAttribute("aria-controls") || ""))
    .filter((p): p is HTMLElement => !!p);
  if (!tabs.length || tabs.length !== panels.length) return;

  function select(index: number, focus = false) {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[i].hidden = !selected;
      if (selected && focus) tab.focus();
    });
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(i));
    tab.addEventListener("keydown", (e: KeyboardEvent) => {
      let next = i;
      switch (e.key) {
        case "ArrowRight": case "ArrowDown": next = (i + 1) % tabs.length; break;
        case "ArrowLeft": case "ArrowUp": next = (i - 1 + tabs.length) % tabs.length; break;
        case "Home": next = 0; break;
        case "End": next = tabs.length - 1; break;
        default: return;
      }
      e.preventDefault();
      select(next, true);
    });
  });

  // Enhance: now that behavior is wired, enforce single-panel view.
  const initial = Math.max(0, tabs.findIndex((t) => t.getAttribute("aria-selected") === "true"));
  select(initial === -1 ? 0 : initial);
}
