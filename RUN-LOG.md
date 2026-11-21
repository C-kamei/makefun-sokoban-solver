# RUN-LOG — sokoban-solver-01-run-20261121

## Round 0 (frozen evaluation)
- House baseline plain-astar 1.0.0 on the practice set: **200,000**
  (i001 solved in P\* 13; i002–i005 unsolved, 200k-expansion cap hit).
  Runtime ~5.9 s.
- Hold-out: three extra sets drawn from the published generator with fresh
  seeds (sokoban-holdout-1/2/3), P\* 13/14/28/48/62, 14/16/31/49/59,
  13/15/28/49/62. Practice set = working set; drawn sets = hold-out.

## Round 1 (adopted)
- Original solver: room decomposition (hallway-row split, cut-based
  fallback) + per-room push-A\* (canonical player region, min-cost
  assignment heuristic, dead squares, 2x2 freeze), fixed expansion budgets.
- Two bugs found and fixed during the round: hallway-row check did not
  account for the parse padding (x=1 is a wall), and the cut-detected room
  omitted its door cell from the room floor (heuristic went Infinity).
- Practice set: **1,000,000** (all 5 instances in exactly P\*), 0.4 s.
- Hold-out 1/2/3: **1,000,000** each, ~0.4–0.6 s per set.
- Max expansions used by any room in testing: ~1,100 (budget 1,500,000).
- Determinism: two runs byte-identical; `grade-local --driver process`
  reproduces 1,000,000 and an L1 regrade byte for byte.

## Rounds 2–3
- Not run. Round 1 already hits the maximum possible score (1,000,000) on
  the working set and on all three hold-out sets, so no change can improve
  the hold-out score; per the improvement flow the run stops at the best
  checkpoint.
