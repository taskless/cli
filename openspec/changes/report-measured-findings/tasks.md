## 1. Extract the scan from `check`

- [x] 1.1 Move the run-directory, `planCheck`, engine-config assembly, and `runEngines` steps of `packages/cli/src/commands/check.ts` into a function under `packages/cli/src/rules/` that returns the plan, the dispatch, and the run's relative path, and have `check` call it; verify `pnpm --filter @taskless/cli test check` (check, check-rule-filter, check-snapshot, check-gitignore, mixed-engine-check, runtime-check) passes unchanged
- [x] 1.2 Confirm the extracted function with `anonymous: true` makes no network call by adding a test that runs it with fetch stubbed to throw over a fixture with `sg`, `vale`, and `runtime` rules, and asserts runtime rules are skipped and sg/vale results return

## 2. Measure findings for the report

- [ ] 2.1 Refresh `packages/cli/src/generated/report-v1.schema.json` with `pnpm --filter @taskless/cli generate:report-schema` and update `ReportV1` in `packages/cli/src/report/types.ts` (add `findings`, `state`, `violations`, `files`, `surfaced`; drop `fixed`, `fixedBasis`, `origin`, `perMonth`, `PerTier`); verify `pnpm typecheck` reports only the call sites groups 2 and 3 fix
- [ ] 2.2 Add the all-or-nothing counting function in `packages/cli/src/report/` (per-rule `violations`/`files`, distinct `findings.files` by repo-relative path, omitted on legacy, local runtime, any plan or dispatch failure, or an unattributed `ruleId`); verify with unit tests covering every scenario under "The CLI measures what the rules find today"
- [ ] 2.3 Run the scan from `buildDraft` and carry the counts on each local rule and as draft-level `findings`; verify a `report.test.ts` case over a fixture repo with known violations prints them in the draft

## 3. Facts, assembly, and summary

- [ ] 3.1 In `packages/cli/src/schemas/report-facts.ts`, drop `fixed` and `fixedBasis`, rename `origin` to `surfaced` with `{ prs, reviewComments }` and descriptions matching the recipe's counting method; verify a test that facts carrying `fixed`, `fixedBasis`, `origin`, `violations`, `findings`, or `perMonth` are refused with `REPORT_INVALID`
- [ ] 3.2 In `packages/cli/src/report/assemble.ts`, set `state` per tier, carry `surfaced`, re-apply the counting function after merging facts (a `legacy` entry removes the counts), and send `projection: { inputs }` only; verify every assembled payload in `report.test.ts` passes `reportSchemaIssues` against the refreshed schema, including one with findings and one with a legacy rule and none
- [ ] 3.3 Rewrite `packages/cli/src/report/summary.ts` to print the findings line when present and the raw `surfaced` totals over the window, with no monthly rate; verify summary tests for the with-findings and without-findings scenarios
- [ ] 3.4 Update `report-telemetry.test.ts` and any other report test that built `fixed`/`origin`/`perMonth` fixtures; verify `pnpm --filter @taskless/cli test report` passes

## 4. Recipes

- [ ] 4.1 Rewrite `packages/cli/src/agent/report.md` step 2 to drop fix counting, state the single `surfaced` counting method (merged in window, read each comment, bots and the PR author count), note that the draft's `findings` are measured by the CLI and cannot be supplied, and require the agent's own recap to label "in the code today" apart from "raised in review over the window"; bump its topic version; verify `pnpm --filter @taskless/cli test prompts recipe` passes
- [ ] 4.2 Update `packages/cli/src/agent/onboard.md` step 6 to note `surfaced` counts by the report recipe's method instead of how often a pattern was fixed; bump its topic version; verify the same prompt tests pass

## 5. Release and checks

- [ ] 5.1 Add a `patch` changeset for `@taskless/cli` describing the measured findings and the removed fix counts, noting the report fields were never released; verify the file exists under `.changeset/`
- [ ] 5.2 Run `pnpm typecheck` and `pnpm lint` and verify both pass
- [ ] 5.3 Build with `pnpm build:next`, run `pnpm cli report` in a scratch repo with known violations, and verify the draft's `findings` match `pnpm cli check --json --anonymous` for the same tree
