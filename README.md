# sokoban-solver-01-run-20261121 — push-optimal Sokoban solver

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/C-kamei/makefun-sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/C-kamei/makefun-sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

Entry for make.fun `sokoban-solver-01-run-20261121` ($100 over 10 places,
deadline 2026-11-23 03:00 UTC). `main.ts` is an original implementation that
solves every instance push-optimally: it scores **1,000,000 on the practice
set** (all 5 instances in exactly P\* pushes) and the same on three freshly
drawn hold-out sets. The house baseline, plain-astar 1.0.0, scores 200,000
(it solves only i001).

## Design

A level is a hallway one square wide with rooms off it, each room opening
through a single door; a box pushed out of a door can never be pushed back,
so every box stays in its room and the level's push-optimum P\* is the sum of
the rooms' optima. The solver therefore:

1. **Finds the rooms.** The floor minus the hallway row (the player's row,
   one contiguous run of floor) splits into one component per room; a
   cut-based fallback (a door is a cell whose removal separates a small
   component holding as many boxes as goals) covers odd layouts. Both paths
   were verified on the practice set and three drawn hold-out sets.
2. **Solves each room push-optimally** with A\* over pushes. A state is the
   sorted box cells plus the player's reachable region (canonicalised to its
   lowest cell). The heuristic is the minimum-cost assignment of boxes to
   goals on static walking distances (admissible: one push moves one box one
   cell). Dead squares (reverse pull-reachability from the goals) and 2x2
   freeze deadlocks prune the search.
3. **Stitches the rooms together** with walks along the hallway.

Scoring note: an instance is worth 1,000 points only in exactly P\* pushes,
and 500·P\*/pushes in more, so push-optimality per room is what matters; the
number of walking steps is irrelevant to the score.

## Measured results (local, Node v24.22.1, this VM)

| set | score | pushes per instance (P\*) | runtime |
| --- | --- | --- | --- |
| practice | **1,000,000** | 13 / 16 / 29 / 47 / 60 (all = P\*) | 0.4 s |
| hold-out 1 (fresh draw) | **1,000,000** | 13 / 14 / 28 / 48 / 62 (all = P\*) | 0.4 s |
| hold-out 2 (fresh draw) | **1,000,000** | 14 / 16 / 31 / 49 / 59 (all = P\*) | 0.6 s |
| hold-out 3 (fresh draw) | **1,000,000** | 13 / 15 / 28 / 49 / 62 (all = P\*) | 0.6 s |

Two executions write byte-identical outputs (verified with the kit's
`grade-local`, which also reproduces the 1,000,000). Budgets are fixed
expansion counts (1,500,000 per room), never the wall clock, so the run is
deterministic; the most a room ever needed in testing was ~1,100 expansions.
Total runtime is ~0.6 s per set against a 60 s wall budget.

Repo size: ~22 kB, far under the 1 MiB limit.

## Files

- `main.ts` — the entry. Dependency-free, plain JavaScript in a `.ts` file
  (no type annotations), reads `/input/<id>/level.txt`, writes
  `/output/<id>/solution.txt`.
- `LICENSE` — MIT (the kit starter's file, unchanged).

---

<sub>Entered on [make.fun](https://make.fun/?ref=fk5m5avs&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
