PR 1 is groups 1–4 (bottom of the stack, targets `main`). PR 2 is groups 5–8.

## 1. Pass one: `verify` becomes `validate`

- [x] 1.1 Rename the `verify` command to `validate` (`commands/names.ts`, `src/index.ts`, `commands/verify.ts` meta and `label`, summary wording "validated"), along with `verifyCommand` → `validateCommand` and `verifyOneRule` → `validateOneRule`. Verify: `pnpm typecheck` passes and `pnpm cli validate .taskless/rules` prints the old `verify` output with the new wording.
- [x] 1.2 Rename the `verify-rule` agent topic to `validate-rule` (file, `prompts/index.ts` topic list, `rule.md` index, every `agent verify-rule` link), bump its topic version, and rewrite its body for `validate`. Verify: `pnpm cli agent validate-rule` prints it and `pnpm cli agent verify-rule` is unknown.
- [x] 1.3 Rewrite every message, recipe and comment that means the old `verify` to say `validate`: refusals in `check`, `rule delete`, migrations and notices, and the `create-*-rule`, `improve-rule` (both variants), `update`, `init` and `route` recipes. Verify: `test/recipe-cross-references.test.ts` passes, and `git grep -nE 'taskless verify|\`verify\`'`returns only hits that are about to become the new`verify` in pass two.
- [x] 1.4 Update the tests that assert on the old `verify` name or wording. Verify: `pnpm test` passes. Then commit pass one.

## 2. Pass two: `test` becomes `verify`

- [x] 2.1 Rename the `test` command to `verify` (`names.ts`, `index.ts`, `commands/verify.ts` meta and `label`, summary wording "verified"), along with `testCommand` → `verifyCommand` and `testOneRule` → `verifyOneRule`. Verify: `pnpm typecheck` passes, `pnpm cli verify .taskless/rules` runs the fixtures, and `pnpm cli test` fails as an unknown command.
- [x] 2.2 Rename `schemas/verify-test.ts` → `schemas/rule-check.ts`, and export `ruleCheckOutputSchema` from `./schemas` and remove the `verifyTestOutputSchema` name. Update the path in `.taskless/rules/sg/no-unrouted-cli-invocation/no-unrouted-cli-invocation.yml`. Verify: `test/schemas-export.test.ts` passes, imports `ruleCheckOutputSchema`, and asserts `verifyTestOutputSchema` is no longer exported.
- [x] 2.3 Rewrite every message, recipe and comment that means the old `test` to say `verify`, including `.github/workflows/demo-rule.yml`, `example/README.md`, `CLAUDE.md`, and the pending changeset `.changeset/sg-empty-scope-notice.md`. Verify: `test/recipe-cross-references.test.ts` passes, and the sweep in 4.3 is clean.
- [x] 2.4 Update the tests that assert on `test` (name, wording, `tested`). Verify: `pnpm test` passes. Then commit pass two.

## 3. Corpus, specs and changeset

- [x] 3.1 Change `enforcedBy` to `"validate" | "verify"` in `rules/constraints.ts`, mapping each entry one to one (`verify` → `validate`, `test` → `verify`), and rewrite the rationale text that names the commands. Verify: `test/constraints.test.ts` passes.
- [x] 3.2 Set `REFERENCE_VERSION = 3`, rewrite the evaluator steps in `rules/reference.ts` to name `taskless validate` then `taskless verify`, and regenerate `assets/reference.json`. Verify: `test/reference.test.ts` passes and the regenerated file reads `"version": 3`.
- [x] 3.3 Edit the Purpose line of `openspec/specs/cli-rule-validation/spec.md` directly to name `validate` and `verify` (a delta can't change it). Verify: `pnpm openspec validate --strict --all` passes.
- [x] 3.4 Add a `minor` changeset on this branch. It says `verify` → `validate` and `test` → `verify`, that an old `verify` caller now gets the stricter fixture-running command, that the topic is now `validate-rule`, that the `./schemas` export `verifyTestOutputSchema` is renamed `ruleCheckOutputSchema`, and that the corpus's own `version` (now 3) is the signal for `enforcedBy`. Verify: the changeset workflow reports it.

## 4. PR 1 checks and opening

- [x] 4.1 Rebase onto the latest `origin/main`. Verify: `git rev-list --count HEAD..origin/main` is 0.
- [x] 4.2 Run `pnpm typecheck`, `pnpm lint` and `pnpm test`. Verify: all three pass.
- [x] 4.3 Sweep for stale meanings: `git grep -nE '\b(verif\w*|tested|test)\b' -- packages/cli/src/agent packages/cli/src/commands packages/cli/src/rules openspec/specs`, reading each hit, and record the pattern in the PR body. Verify: no hit means the old command.
- [x] 4.4 Run the archive check on a scratch copy of `openspec/`, comparing scenario titles per spec before and after. Verify: every prior scenario is present, and the only title changes are the two the REMOVED reason names.
- [ ] 4.5 Request the on-demand Claude review, address the findings, and confirm with the user before merging. Verify: review posted and findings resolved.

## 5. `validate`: the ast-grep engine parse

- [x] 5.1 Measure against ast-grep 0.45.3 that `sg scan -r <file> --stdin` with empty input exits 8 with the message for an invalid `kind` (`readonly`, Markdown `link`) and an unknown `language:`, and exits 0 for a valid rule. Time it over this repository's rules. Record the measurements in the module's header comment. Verify: the comment states each case and its exit code.
- [x] 5.2 Add the parse as a layer in `validate`, run only after the schema layer passes, reporting ast-grep's message in `errors` with no violation. Verify: tests for "A kind the grammar does not have is rejected", "An engine config error is reported under the rule that has it", and "An engine refusal carries no constraint id".

## 6. `validate`: top-level `strictness`

- [x] 6.1 Add `sg-no-top-level-strictness` to `RULE_CONSTRAINTS` (`enforcedBy: "validate"`) and enforce it, with a message naming the pattern object as where the key belongs. Regenerate `assets/reference.json`. Verify: a test for "A top-level strictness is rejected", plus a passing `test/reference.test.ts`.

## 7. `validate`: trap notices

- [x] 7.1 Add the `$$$`-beside-a-comma detector over pattern strings and object-pattern `context`. Verify: tests for "A comma beside $$$ draws a notice" and "A pattern that already uses strictness ast draws no notice".
- [x] 7.2 Add the `follows`/`precedes`-without-`stopBy` detector. Verify: a test for "A sibling relation without stopBy draws a notice", including the `stopBy: end` silent case.
- [x] 7.3 Add the awaited-generic-callee detector for `TypeScript`/`Tsx`. Verify: a test for "A callee regex under TypeScript draws a notice", plus "A method callee regex under TypeScript draws a notice", including the `await_expression` branch and other-language silent cases. Use the recipe's own workaround YAML (topic v7 and later) as the silent fixture, so the detector can't flag the fix the recipe recommends.
- [x] 7.4 Point `create-sg-rule`'s Quirks section at the notices: say which quirks `validate` now reports, and that the keyword-`kind` and Markdown-inline config errors are now caught by `validate` under the rule's own name. Bump the topic version. Verify: `pnpm cli agent create-sg-rule` shows the change after `pnpm build`.
- [x] 7.5 Verify that a trap notice doesn't fail `verify`. Verify: a test for "A trap notice does not fail verify".

## 8. `verify`: isolated fixture run, then PR 2

- [x] 8.1 Build a temporary one-rule `sgconfig.yml` for `runTests` and remove it afterwards. Verify: a test for "Another rule's config error does not fail this rule's fixtures", which reproduces gap 2 with a `kw` rule holding `kind: readonly`. Also check that no file is left behind.
- [x] 8.2 Extend the changeset with the new `validate` checks. Verify: one changeset file, one release note.
- [x] 8.3 Run `pnpm typecheck`, `pnpm lint` and `pnpm test`, then archive the change with `pnpm openspec archive rename-rule-checks -y`. Verify: everything passes, and the archived specs keep every scenario (repeat the 4.4 comparison).
- [ ] 8.4 Open PR 2 on top of PR 1, request the review, address the findings, and confirm with the user before merging. Verify: review posted and findings resolved.
