## 1. Design

- [x] 1.1 Read `buildIsolatingConfig` and establish whether it is the right mechanism for a project walk (it is not: its `[*]` matcher discards the rule's own scope).
- [x] 1.2 Confirm the vendored ast-grep exposes a rule-id filter for `scan` (`--filter <REGEX>`, 0.45.3) and that the config schema forbids a rule assigning another rule's key.

## 2. Implementation

- [x] 2.1 `packages/cli/src/rules/rule-filter.ts`: resolve requested ids into a per-engine selection; refuse an unknown id with `RULE_NOT_FOUND`.
- [x] 2.2 `packages/cli/src/rules/scan.ts`: `sgFilterArgv` emitting an anchored `--filter`, threaded through `runAstGrepScan`.
- [x] 2.3 `packages/cli/src/rules/assemble.ts`: `AssembleOptions.ruleIds` narrowing the Vale assembly.
- [x] 2.4 `packages/cli/src/rules/dispatch.ts`: carry the ast-grep selection to the scan.
- [x] 2.5 `packages/cli/src/commands/check.ts`: the `--rule` flag, repeatable argv parsing, `--rule` as a value-taking flag for the positional scanner, selection applied to all three engines.
- [x] 2.6 `.changeset/check-rule-filter.md` (`patch`).

## 3. Tests

- [x] 3.1 `packages/cli/test/check-rule-filter.test.ts`: a single `--rule` narrows an ast-grep run and a Vale run; repeated `--rule` unions across engines; an unknown id errors naming it; the gitignore exclusions still hold under a filter; the filtered result equals the unfiltered run's findings for that id, for both engines.
- [x] 3.2 Unit coverage for the repeatable argv parsing and the anchored filter argv.

## 4. Spec

- [x] 4.1 Add the `cli-check` requirement "Check restricts the run to named rules with --rule" as an ADDED block; nothing existing needs modifying.
- [x] 4.2 `pnpm openspec validate check-rule-filter --strict`, then the dry-run archive check from CLAUDE.md (scenario count before vs after), then archive for real.

## 5. Verification

- [x] 5.1 `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @taskless/cli test` all pass.
