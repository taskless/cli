## 1. Per-kind summary counts

- [x] 1.1 Replace `groupTotals` usage with `sourceCounts` in `src/report/evidence.ts` (derived from `RULE_SOURCES` and `SOURCE_GROUPS`) and format per-kind labels in `src/report/summary.ts`
- [x] 1.2 Remove dead `groupTotals` export, update comments in `src/report/summary.ts`, and update `"evidence totals"` to `"evidence by kind"` in `src/agent/report.md`
- [x] 1.3 Update `renderSummary` tests in `test/report.test.ts`, including asserting the commits-only case on the rule's own line

## 2. Spec, changeset, and verification

- [x] 2.1 Add `patch` changeset in `.changeset/report-evidence-labels.md`
- [x] 2.2 Validate OpenSpec delta, run pre-archive check, and archive `report-evidence-labels`
- [x] 2.3 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`
