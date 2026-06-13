# Bracket projection — algorithm

The bracket is always shown, even before any knockout team is known, by *projecting* it. The
projection is odds-seeded, then self-corrects from live standings, locking each slot as reality
decides it. `reference/bracket-prediction.py` is a runnable reference — your TS port should
reproduce its output for the pre-tournament case.

## The bracket graph

`data/fixtures.json` matches 73–104 are the knockouts. Their `team1`/`team2` are **slot codes**,
not teams:

| Code form | Means |
|---|---|
| `1A`, `2B` | winner / runner-up of that group |
| `3A/B/C/D/F` | a third-placed team from one of those groups (a best-thirds slot) |
| `W91` | winner of match 91 |
| `L101` | loser of match 101 (used only by the third-place playoff) |

## Resolving a slot to a team

Two pluggable inputs drive everything:

1. **`ranking(group)` → [1st, 2nd, 3rd, 4th]**
   - Pre-tournament: order by `oddsValue` ascending (lower = stronger).
   - Live: order by the real group table (Points → GD → GF → … ), from ESPN standings. Use odds
     as the final tiebreaker for not-yet-decided ties.
2. **`winnerOf(a, b)` → team**
   - Pre-tournament: the lower-`oddsValue` team.
   - Live: the real result once the match is played; otherwise fall back to the odds pick.

Then:
- `1X`/`2X` → `ranking(X)[0]` / `ranking(X)[1]`.
- Best-thirds slots → see below.
- `W##`/`L##` → resolve match `##`'s two teams recursively, apply `winnerOf`, return winner (or
  the other team for `L##`).

Memoize match winners; the graph is a DAG so a simple recursion + cache is enough.

## Best-thirds assignment

The 8 third-place slots take "a third-placed team from one of {group set}". Steps:

1. Collect the 12 third-placed teams (`ranking(g)[2]` for each group).
2. Rank them (pre: by odds; live: by Points → GD → GF) and take the **top 8** — those qualify.
3. **Bijectively match** the 8 qualifying thirds to the 8 slots so each third lands in a slot
   whose allowed-group set contains the third's group. A small backtracking search does it (see
   the reference). A valid matching always exists for any 8-of-12 combination.

> Caveat: FIFA assigns thirds to slots via a fixed lookup table; this matching approximates it.
> That's fine because it only ever shows *during* the group stage. **Once the group stage ends,
> stop projecting the R32 entirely and use ESPN's real knockout fixtures** (`reference/DATA-SOURCES.md`).

## Live blending — confirmed vs. predicted

Render each slot in one of two states:

- **Confirmed** (solid): reality has fixed it. A group's 1st/2nd/3rd are confirmed once that group
  has played all its games; a knockout participant is confirmed once its feeder match is final.
- **Predicted** (dashed/dimmed, "predicted" tag): everything not yet confirmed. Recompute it on
  each data refresh using current standings, so predictions improve as the group stage unfolds.

Progression in practice:
- Group stage in progress → most of the bracket is predicted; group winner/runner-up slots
  confirm group-by-group as each finishes.
- Group stage complete → the full R32 confirms (switch to ESPN's real fixtures). Later rounds stay
  predicted (from projected/real winners) until their feeder games are played.
- Each knockout round → confirms as it's played.

## Eliminated teams

Independent of the bracket projection, mark a team **eliminated** (greyed `.elim` everywhere) once
it cannot advance: in the group stage, when it's mathematically out of the top 2 *and* out of
best-thirds contention; in the knockouts, when it loses its tie. Drive this from live results.
