## 1. Spec

- [x] 1.1 Restate "Test runs a rule's fixtures and runs verify first" in full — all 8 standing scenarios, byte-identical titles, and the full normative prose — with the findings requirement added. Verify by archiving into a throwaway commit and counting scenarios before and after.

## 2. Schema

- [x] 2.1 `schemas/verify-test.ts`: a `findings` array on `ruleResultSchema`, carrying the `CheckResult` fields plus `bucket: "pass" | "fail"`, defaulted to `[]` so every rule result in both commands' output carries it.

## 3. Engines

- [x] 3.1 `rules/vale/verify.ts`: carry the filtered `CheckResult[]` on `ValeRuleVerification` alongside `firedIn`, each finding bucketed by whether its file is a `pass/` or `fail/` fixture. Leave `missingFailures`/`unexpectedFindings` as they are.
- [x] 3.2 `rules/runtime/run-fixtures.ts`: collect `execution.findings` per case onto the report, tagged with the case's bucket.
- [x] 3.3 `rules/inspect.ts`: `findings` on `RuleTestResult`, populated from both engines, `[]` for ast-grep and on every path that returns before fixtures run.

## 4. Human rendering

- [x] 4.1 `commands/verify.ts`: under a failing rule print the bearing findings, labelled by bucket, through `util/format.ts`'s `formatText`. One line per passing rule, unchanged.

## 5. Tests

- [x] 5.1 Vale and runtime, both buckets, `--json` and human paths.
- [x] 5.2 A message-order regression: a `substitution` rule whose rendered message interpolates a token, asserting the rendered text, failing if the slots are swapped.
- [x] 5.3 A pass-bucket finding appears on the human path when the rule failed.
- [x] 5.4 `findings` present and empty for an ast-grep rule.

## 6. Release

- [x] 6.1 `.changeset/test-show-fixture-findings.md`, `patch`, noting that `zod`'s `parse()` strips unknown keys so a consumer on the old published schema drops the new field until they upgrade.
- [x] 6.2 `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
