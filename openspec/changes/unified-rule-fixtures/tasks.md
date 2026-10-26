Stacked, merged atomically with `gh stack merge`. The task groups describe the work; the branches group it so each layer is green on its own (see proposal, Delivery shape). Pause for review after each group (CLAUDE.md, OpenSpec Apply).

## 1. Engine plumbing (bottom branch)

- [x] 1.1 Pin the measured Vale 3.24.0 behavior (design, Context) in `vale-vendor-contract.test.ts`: with cwd = case and `[docs/**/*.md]`, `docs/guide/x.md` fires and `x.md` does not; the same tree passed from its parent fires nothing; a document under `.github/` is walked. Add the ast-grep equivalents to `ast-grep-vendor-contract.test.ts`. Verify both pass.
- [x] 1.2 Add `.changeset/*.md` (`patch`, `@taskless/cli`) describing the layout move, the scaffold bump to 12, and the `SCAFFOLD_VERSION_MISMATCH` a pinned older CLI will report. Verify `changeset.yml` reports it on the PR.
- [x] 1.3 Make `assembleSgConfig` copy each selected rule's `<id>.yml` into a rules-only tree in the run directory and point `ruleDirs` at it (D2). Verify that `check` on this repository produces identical findings before and after (diff `pnpm cli check --json`), and that a test with a plain `tests/` directory inside an `sg` rule passes `check`.
- [x] 1.4 Keep the `ast-grep-vendor-contract.test.ts` assertion that a plain `tests/` inside `ruleDirs` fails, re-pointed to document why D2 exists. Verify it passes on 0.51.0.
- [x] 1.5 Set `RULE_TESTS_DIRECTORY = "tests"`, narrow `FixtureLayout` to `"case-directories"` for every `ENGINE_LAYOUTS` entry, and rewrite the layout comments. Verify `pnpm typecheck` and that `@taskless/cli/layout` still builds under the host-capability guard.
- [x] 1.6 Move the case-directory bucket reader from `runtime/fixtures.ts` into `rules/fixtures.ts` as the one reader for every engine, refusing loose bucket files and stray `tests/` entries. Verify with the existing loose-file/unreadable-bucket tests moved to cover all three engines.

## 2. One verify loop (branch 2)

- [x] 2.1 Add the shared judging loop to `rules/fixtures.ts` (fail ≥1 / pass 0, coverage, `bucket` on findings) over an engine-supplied `runCheck(rule, root)`. Verify with unit tests over a fake engine covering every coverage state.
- [x] 2.2 ast-grep `runCheck`: `runSg` with cwd = case, a one-rule config from 1.3, and `--rule <id>`. Delete `sg-fixture-findings.ts`, the `sg test` path in `verify.ts`, and `test-fixture-findings.test.ts`. Verify that `verify.test.ts` covers a scoped rule firing at the glob path and staying quiet at the case root, and that another rule's bad `language:` does not reach the case.
- [x] 2.3 Vale `runCheck`: cwd = case, a config built from the rule's own `.vale.ini` alone (D1). Verify `vale-verify.test.ts` covers the matcher-scoped scenario from the `cli-vale-rule-engine` delta, and that another rule's refused `.vale.ini` does not fail this rule.
- [x] 2.4 Runtime `runCheck`: route `executeRuntimeRule` through the shared loop and keep the flag gating. Verify `runtime-fixture-runner.test.ts` passes unchanged apart from paths.
- [x] 2.5 The unscoped diagnostic run for a quiet `fail/` case (D3): ast-grep strips `files`/`ignores` from a copy in the run directory, and Vale uses `buildIsolatingConfig`. Verify both messages ("scope excluded" with globs/matchers named, and "did not match") in tests, and that the verdict is unchanged.
- [x] 2.6 Verify writes nothing under `.taskless/rules/` and leaves no run directory without `--preserve-logs`. Verify with a test that snapshots the tree before and after.
- [x] 2.7 Measure `pnpm cli verify` across this repository's rules and record the time per case in the PR, choosing the concurrency cap from it. Measured: 14 rules, about 100 cases, 2.2 s wall clock run sequentially, so no concurrency cap was added.

## 3. Migration and delivery (branch 3)

- [x] 3.1 Add `rules/fixture-convert.ts`: the language → extension table, scope → path derivation checked with `path.matchesGlob`, and ordinal case naming (D4). Add a vendor-contract assertion that the table covers every language ast-grep 0.51.0 accepts. Verify with unit tests over this repository's seven scoped/unscoped `sg` rules and a deliberately underivable glob.
- [x] 3.2 Add scaffold migration `0012`: sg snippets → cases, Vale documents → cases, runtime rename, never delete the unconverted, idempotent. Verify with migration tests for every scenario in the `cli-taskless-bootstrap` delta, including a fresh scaffold running 1–12.
- [x] 3.3 Point `rule-migrations/vale-3-24-0-tests-to-fixtures.ts` at the new layout (D5). Verify its existing tests with updated paths.
- [x] 3.4 Delivery: migrate an old-format response just in time. Treat `.tests/` as unsigned fixtures, convert them through `fixture-convert.ts` before writing, name anything unplaceable, and pass a new-layout set through unchanged (D6). Verify with `verify-delivery.test.ts` and deliver tests serving one v2 set of each shape.
- [x] 3.5 Reconcile and signing exclude `tests/` and `.tests/`. Verify with a reconcile test whose rule holds both and reports neither.
- [x] 3.6 Run migration 12 on this repository's `.taskless/rules/`, rename the ordinal cases to descriptions, and confirm every rule still passes `pnpm cli verify`. Fix any fixture that only passed because stdin bypassed `files:`, and list those fixes in the PR body.

## 4. Recipes, corpus, and archive (tip branch)

- [x] 4.1 Write the shared fixture section and point `create-sg-rule`, `create-vale-rule`, `create-runtime-rule`, `improve-rule` and `validate-rule` at it, removing their per-engine layout copies. Pass explicit paths to prettier, never `src/` (memory: prompt parity). Verify the prompt parity tests and `pnpm lint`.
- [x] 4.2 `reference.json`: a case list for every engine, `grouping: case-directories`, and an incremented corpus `version`. Verify `reference.test.ts` covers every scenario in the `cli-conformance-reference` delta.
- [x] 4.3 Update `.taskless/rules` READMEs, CONTRIBUTING and any doc naming `.tests/`. Verify `grep -rn '\.tests/'` outside migrations, the delivery JIT conversion and the CHANGELOG returns nothing unexpected.
- [ ] 4.4 Note the new layout and corpus version in the CLI collab artifact as information for Cloud, stating that no action is required because delivery migrates the old format just in time (memory: cloud collab artifacts). Verify the artifact reads back with the note.
- [x] 4.5 Run `pnpm typecheck` and `pnpm lint` across the stack tip. Archive the change on the tip (`pnpm openspec archive unified-rule-fixtures -y`), confirming every prior scenario survives per CLAUDE.md, then land the stack with `gh stack merge`.
