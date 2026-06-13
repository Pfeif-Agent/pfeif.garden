# Design reference

The full look is already encoded in `phase1/wc2026-draft.astro`. Phase 2 should **reuse its CSS
classes and tokens** rather than introduce new styling. This file is the cheat-sheet.

## Tokens (CSS custom properties, defined on `:root` in the page)

```
--ground:  #0B0E0D   page background (dark)
--panel:   #141816   card surface
--panel-2: #0F1311   inset / secondary surface
--line:    #272D29   borders / hairlines
--chalk:   #F2F5EE   primary text
--sage:    #97A59E   secondary text
--sage-dim:#66716B   tertiary / muted text
--gold:    #F2C14E   accent: favorites, champion, active emphasis
--grass:   #38D17A   accent: live / "advancing" marker
```

Background is a subtle radial wash toward `--ground`. Corners ~10–14px. Borders are 1px `--line`.

## Fonts (Google Fonts; confirm CSP allows `fonts.googleapis.com` + `fonts.gstatic.com`)

- **Anton** — display headings (the big "WORLD CUP 2026", round names where condensed).
- **Inter** — body / UI text (weights 400–700).
- **JetBrains Mono** — labels, eyebrows, numbers, odds, tags (uppercase, letter-spaced).

## Manager colors (also in `data/draft.ts`)

Jacob `#FF6B5E` (red) · Taylor `#4EA8FF` (blue) · Brad `#B57BFF` (purple). Used as a small dot or
swatch next to any team that manager owns; set via a `--rc` custom property on roster cards.

## Odds tiers (favorite highlighting)

`oddsValue <= 9` → gold (`.od.fav`) · `<= 150` → sage (`.od.mid`) · else muted. Helper already in
the page; mirror it for any new team chips.

## Visual states (important for Phase 2)

- **Confirmed** — normal solid card. Default once reality fixes a slot/result.
- **Predicted** — dashed border + dimmed text + a small "predicted" tag. Classes already present:
  `.match.pred` (Upcoming rows) and the dashed `.matchup` (Bracket). Toggle these off as slots confirm.
- **Eliminated** — `.elim` (strike-through + reduced opacity) on the team name, wherever the team
  appears (rosters, bracket, upcoming). Already defined; Phase 2 just adds the class from live state.
- **Advancing / projected winner** — within a bracket matchup, the advancer gets `.mu-team.win`
  (brighter) and a grass-colored `▸` marker.
- **Champion** — the gold-bordered "projected/actual champion" callout at the top of the bracket.
- **Live** — use `--grass` for live indicators (e.g. a pulsing dot on in-progress matches); the
  footer already has a `.live` marker pattern to match.

## Layout notes

- Five CSS-only tabs via hidden radio inputs + `:checked ~ .panels #p-…` (no JS). Add the
  Standings tab the same way.
- Responsive: 3-column grids collapse to 1–2 columns under 760px / 430px (see the page's media
  queries). Keep new views mobile-first; the bracket is laid out **by round**, not as a connected
  tree, specifically so it works on a phone.
