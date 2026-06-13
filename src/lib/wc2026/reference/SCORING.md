# Scoring — the "B+2" ladder

Defined in code as `SCORING` in `data/draft.ts`. Points are awarded to **whoever drafted the
team**. A team accumulates points across the whole tournament.

| Result | Points |
|---|---|
| Group-stage win | 3 |
| Group-stage draw | 1 |
| Advance out of the group (reach Round of 32) | 2 |
| Win in Round of 32 | 4 |
| Win in Round of 16 | 6 |
| Win in Quarterfinal | 8 |
| Win in Semifinal | 10 |
| Win the Final | 12 |
| Third-place playoff | 0 (scores nothing) |

## How to apply it

- **Group stage:** +3 per win, +1 per draw, per match (each team plays 3 group games).
- **Advance bonus (+2):** awarded once, when a team is confirmed into the Round of 32 (top-2 in
  its group, or one of the 8 best third-placed teams). This is the underdog reward — a team gets
  it just for escaping the group, even if it then loses immediately.
- **Knockout wins:** the points above go to the team that **wins** that round's match (i.e.
  advances). A knockout match is decided by penalties if level after extra time — the team that
  advances is the "winner" for scoring. The loser gets nothing for that round.
- **Third-place playoff:** worth 0. The two losing semifinalists already banked their semifinal
  appearance via earlier rounds; the bronze match itself scores nothing.

A group-winning eventual champion is worth **51**: 9 (three group wins) + 2 (advance) + 4 + 6 + 8 + 10 + 12.

## Why it's shaped this way (context, not a spec)

The goal was to reward underdogs and Cinderella runs without odds-weighting. We landed here after
simulating thousands of tournaments:

- A **flat top** (final only 12, not a blowout) keeps owning the champion from dominating.
- The **+2 advance bonus** is the real lever — it pays a roster of underdogs for merely surviving
  the group, which a flatter knockout ladder alone does *not* do.
- Net effect vs. a steep ladder: the pool goes from a near-lock for the best roster to a genuine
  three-way race; a longshot reaching the semis is worth ~20 points to its owner; and roughly a
  third of titles are won *without* owning the actual champion.

One finding worth knowing so nobody re-tunes endlessly: **who wins is driven far more by the draft
than by the ladder.** Across every ladder shape we tried (steep, flat, even inverted), the
manager-win distribution barely moved, because the strongest roster stays the favorite under any
scoring. B+2 was chosen as a sane, competitive, underdog-friendly point — not a magic equalizer.
