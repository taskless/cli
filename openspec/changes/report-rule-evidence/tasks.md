## 1. Contract and facts

- [x] 1.1 Commit the regenerated `src/generated/report-v1.schema.json` (fetched from `https://tskl.es/api/v1/schema` after taskless/taskless#527 deployed) and verify `pnpm --filter @taskless/cli test` still passes against it unchanged
- [x] 1.2 Add `src/report/evidence.ts`: the kinds with the group of each, held equal to the vendored schema's `sources` enum and `evidence` keys by a test, and the kinds that must carry a count; verify with a test that every kind in the vendored schema has a group and that `reviews` is the only kind without an `evidence` key
- [x] 1.3 Add optional `sources` and `evidence` to the shared rule facts in `src/schemas/report-facts.ts`, built from 1.2's kinds, and to `ReportRule` in `src/report/types.ts`; verify the facts schema refuses an unknown kind, a zero count, and an unknown evidence key, and that the `report` recipe's embedded facts schema shows both fields

## 2. Assemble and check

- [x] 2.1 Carry `sources` and `evidence` from `rules`, `legacy` and `cloud` facts to the payload in `assemble.ts`, adding no key when absent; verify with tests that a payload carries them unchanged and validates against the vendored schema, and that facts without them produce the same payload as before
- [x] 2.2 Add the cross-field checks (every rule or none, duplicate kind, `reviews` without review comments, counted kind without its count, count without its kind, `evidence` without `sources`) as `REPORT_INVALID` naming rule and field; verify one test per check fails when that check is disabled, and that `agent-files`/`conventions` without counts pass

## 3. Summary

- [x] 3.1 Add each rule's evidence totals to its summary line in `summary.ts` (sums, ordering, tie, "1 time", omitted at zero) per design D4; verify with tests for the three summary scenarios in the `cli-report` delta and that a report without evidence renders as before apart from rules with review comments

## 4. Recipes

- [x] 4.1 Rewrite `onboard.md` "Choosing candidates" to tally every source's call-outs per candidate with its kind while mining, crediting commits as `commits` evidence and never as `surfaced`; bump the topic version; verify the recipe tests and the section budget pass
- [x] 4.2 Rename `report.md` "Counting surfaced" to "Counting evidence", add the per-kind call-out definitions, window rule and kinds-not-paths rule, and ask for `sources`/`evidence` in step 2; bump the topic version; verify with `pnpm build && pnpm cli agent report` that the section reads as the delta specifies and the recipe tests and section budget pass

## 5. Ship

- [ ] 5.1 Add a `patch` changeset for `@taskless/cli` describing the new facts fields and summary totals; verify `pnpm typecheck`, `pnpm lint` and `pnpm test` pass
- [ ] 5.2 Run `pnpm openspec validate report-rule-evidence --strict`, then the pre-archive check from AGENTS.md (archive, confirm every prior scenario of `cli-report` and `cli-onboard` survives, reset); archive the change and verify `openspec/changes/` holds only `archive/`
