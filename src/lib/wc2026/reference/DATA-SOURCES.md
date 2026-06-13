# Data sources

Live data comes from **ESPN's public `fifa.world` endpoints** — keyless and CORS-friendly, so they
can be called straight from the browser. They are **unofficial**: shapes can shift and the service
can hiccup, so verify the exact JSON against a live call before wiring fields, cache the last good
response, and degrade gracefully. `data/fixtures.json` (sourced from openfootball) is the stable
fallback for the schedule/bracket graph.

## Endpoints (observed — confirm live before relying on exact paths/fields)

- **Scoreboard / scores**
  `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard`
  Accepts `?dates=YYYYMMDD` or a range `?dates=YYYYMMDD-YYYYMMDD`. Defaults to "today", so always
  pass an explicit range for the stage you're rendering.
- **Standings (group tables)**
  `https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings`

## Scoreboard shape (the fields that matter)

```
events[]
  id, date
  status.type        -> state: "pre" | "in" | "post",  completed: bool
  competitions[0]
    venue.fullName
    broadcasts[]      -> TV
    competitors[]     (two)
      homeAway: "home" | "away"
      winner: bool
      score
      team.displayName, team.abbreviation, team.color, team.logo
league.calendar[]     -> stage names + start/end dates (Group, R32, R16, QF, SF, 3rd, Final)
```

Stage date windows (from the calendar; for choosing scoreboard `dates` ranges):
Group Jun 11–27 · R32 Jun 28–Jul 3 · R16 Jul 4–7 · QF Jul 9–11 · SF Jul 14–15 · 3rd Jul 18 · Final Jul 19.

## Standings shape

Group tables with per-team W/D/L, GF/GA/GD, points, and rank. Use these directly for the live
group ranking (`ranking()` in `reference/PREDICTION.md`) and the qualification picture, rather than
recomputing from individual results.

## Mapping ESPN ↔ our data

- **Team names:** ESPN spellings differ. Always pass ESPN `displayName` through `ALIASES`
  (`data/draft.ts`) to get the league spelling, then `managerOf(name)` for the owner. Known
  differences: `Czech Republic → Czechia`, `Turkey → Türkiye`, `USA → United States`. Add any
  others you hit to `ALIASES`.
- **Matching events to fixtures:** match an ESPN event to a `fixtures.json` row by date + the two
  (aliased) team names for group games. For knockouts, once ESPN publishes real fixtures, prefer
  them over the projected slots; you can still align to a `num` by round + date if you need the
  venue/ordering from `fixtures.json`.
- **Result → scoring:** from a completed event, the team with `winner: true` (or the advancing
  side on penalties) gets the round's points per `reference/SCORING.md`; a group draw gives both
  teams 1.

## Resilience checklist

- Wrap every fetch in try/catch; on failure use the cached last-good payload and surface a quiet
  "live data unavailable / updated Xm ago" note — never blank a view.
- Poll only while the document is visible; back off on repeated errors.
- Don't block first paint on the network: the static page renders, then the live layer fills in.
