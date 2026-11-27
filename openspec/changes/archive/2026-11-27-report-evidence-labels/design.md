## Context

`report-rule-evidence` mirrored tskl.es's two group totals (`reviews` and `conventions`) in the CLI summary. When a rule is credited only by `commits` or `issues`, printing `"N times in reviews"` misleads readers into thinking PR review comments occurred when `surfaced.reviewComments` is 0.

## Decisions

### D1: Name each evidence kind separately in the publish summary

`sourceCounts` in `src/report/evidence.ts` derives its order from `RULE_SOURCES` and `SOURCE_GROUPS`, returning non-zero counts sorted largest first, with `reviews`-group kinds (`reviews`, `commits`, `issues`) before `conventions`-group kinds (`agent-files`, `conventions`, `docs`, `tests`) on a tie and `RULE_SOURCES` order preserved within each group. `evidenceSuffix` in `src/report/summary.ts` formats each kind with its singular/plural label.
