## 1. Schema and payload

- [x] 1.1 Regenerate the vendored ReportV1 schema from tskl.es
- [x] 1.2 Drop `projection` and `complexity` from the payload types and the assembler; drop the draft's default inputs and `estimates` from `missing`
- [x] 1.3 Facts: remove `estimates` and a candidate's `complexity`; require `estimatedViolations` on each candidate and carry it onto the report

## 2. Recipes

- [x] 2.1 Report: ask for the candidate estimate, no value input; remove the all-zero explanation
- [x] 2.2 Onboard: note each runtime candidate's instances for the report

## 3. Tests and release

- [x] 3.1 Update report, telemetry, and onboard tests
- [x] 3.2 Extend the `report-without-review-history` changeset
- [x] 3.3 Run `pnpm typecheck` and `pnpm lint`
- [x] 3.4 Archive this change
