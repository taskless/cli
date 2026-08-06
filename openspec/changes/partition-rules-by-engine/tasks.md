## 1. Migration and directory layout

- [x] 1.1 Add `filesystem/migrations/0004-vale-engine.ts`: move `.taskless/rules/`, `rule-tests/`, and `sgconfig.yml` under `.taskless/sg/` (content-preserving; `ruleDirs: [rules]` is relative and stays valid) — also writes a default `sg/sgconfig.yml` when the project has none to move (it was git-ignored and generated ephemerally before this change)
- [x] 1.2 Extend `0004` to move `.taskless/runtime-rules/ → runtime/rules/` and `runtime-rule-tests/ → runtime/rule-tests/` byte-for-byte (runtime hashes unchanged)
- [x] 1.3 Extend `0004` to scaffold `.taskless/vale/` (`.vale.ini` + `rules/` + `rule-tests/`), writing a `.gitkeep` into every otherwise-empty scaffolded directory, and bump `taskless.json` `version`
- [x] 1.4 Register `0004` in `filesystem/migrate.ts` and confirm `runMigrations` applies it via `ensureTasklessDirectory`
- [x] 1.5 Add version-mismatch gating: `runMigrations` throws when `taskless.json.version > maxVersion` with an "upgrade the CLI" message, unless a global `--allow-version-mismatches` flag is set
- [x] 1.6 Tests: `0004` moves each tree correctly, `.gitkeep` present, runtime contents byte-identical; gating throws and the flag overrides

- [x] 1.7 Anchor the `sgconfig.yml` entry in `.taskless/.gitignore` (`/sgconfig.yml`), so the unanchored pattern `0001` wrote no longer also ignores the committed `.taskless/sg/sgconfig.yml`; `0004` rewrites it in existing checkouts

> Group 1 relocates the trees **and** repoints every reader, so the suite is green on that group alone
> (396 passing). An earlier revision moved the files without following them, which left 20 failures across
> `check.test.ts`, `verify.test.ts`, and `runtime-check.test.ts` — those were two real defects, not an
> artifact of splitting the work: readers kept the pre-move paths, and `check` discovered rules before
> running the migration that creates them. Each group is independently correct; none is expected to be red.

## 2. Engine dispatch (directory model)

- [x] 2.1 Implement directory-based engine discovery: enumerate `.taskless/<engine>/` and route rules by directory, no per-file parsing. `sg` and `runtime` get executors here; `vale/` is recognized as an engine directory but has no executor yet — `rules/engines.ts` (`planEngineDispatch`, `discoverAstGrepRuleSources`)
- [x] 2.2 In `commands/check.ts`, call `ensureTasklessDirectory(cwd)` directly (preserving the migration trigger now that `generateSgConfig` leaves the check path) — `rules/verify.ts` does the same, since the migration moves rules between the paths it resolves
- [x] 2.3 Tests: a rule under `sg/rules/` dispatches to ast-grep and one under `runtime/rules/` to the harness, by directory alone; an unknown engine directory is ignored rather than misrouted — completed in group 3 once 3.1 moved discovery; `test/engine-dispatch.test.ts` and `test/runtime-check.test.ts` now cover both halves
- [x] 2.4 Treat the legacy `.taskless/rules/` path as an ast-grep source alongside `sg/rules/`, so an unmigrated checkout still runs; de-duplicate when both are present
- [x] 2.5 Tests: a `.taskless/` with only `rules/` dispatches to ast-grep; with both `rules/` and `sg/rules/`, findings merge without duplicates

## 2b. Service-delivered rule ingest

- [x] 2b.1 Update `rules/files.ts` — `writeRuleFile` writes `.taskless/sg/rules/<id>.yml` and `writeRuleTestFile` writes `.taskless/sg/rule-tests/`, replacing the hardcoded `.taskless/rules` / `.taskless/rule-tests` (both call sites are `commands/rules.ts:241,245,482,486`)
- [x] 2b.2 Resolve the destination from an engine the payload identifies, defaulting to `sg` when the payload identifies none — permanently, since the API carries no engine discriminator today
- [x] 2b.3 Fail loudly on an engine the CLI does not recognize: error naming the engine, instruct upgrade, write nothing (do NOT fall back to `sg`)
- [x] 2b.4 Audit the remaining `.taskless/rules` string literals for the same defect — at minimum `rules/verify.ts:246`, `rules/files.ts:99`, `commands/check.ts:314`, `commands/rules.ts:661`, and the `detect/scan.ts:428` layout probe. All five now resolve through `rules/engines.ts`; `help/*.txt` still names the legacy path and belongs to 5.3
- [x] 2b.5 Tests: an engine-less payload lands in `sg/rules/` and is dispatched to ast-grep by `check`; a migrated rule and a freshly delivered one come to rest at the same path; an unrecognized engine errors and writes nothing

## 2c. Reconcile compatibility

- [x] 2c.1 Confirm reported reconcile paths follow the moved trees (`rules/runtime/run-set.ts:57` builds repo-relative POSIX paths from the discovered location) — confirmed unchanged; `relative(cwd, rule.checkFile)` is derived from the discovery root, so no edit was needed
- [x] 2c.2 Test: after `0004`, signatures are unchanged and the signature-based join resolves every moved rule — nothing reports as new or missing. Asserted at the reporting layer (same signature, moved path) rather than against a live server

## 3. Runtime discovery path

- [x] 3.1 Update `rules/runtime/discover.ts` to read `.taskless/runtime/rules/<name>/` and fixtures from `runtime/rule-tests/<name>/` (was `runtime-rules/`) — `RUNTIME_RULES_DIR` now derives from `ENGINE_LAYOUTS.runtime`. No code reads the rule-tests fixtures yet (only `0004` moves them), so only the rules path needed a change
- [x] 3.2 Confirm rules under `.taskless/sg/rules/` are treated as static, not runtime — discovery only ever enumerates the `runtime` engine directory; covered by a test that files a runtime-shaped capture under `sg/rules/` and asserts it is never discovered as runtime
- [x] 3.3 Tests: runtime discovery at the new path; execution/reconcile/signing behavior unchanged — `runtime-check.test.ts` and `runtime-harness.test.ts` now seed the engine layout and pass unmodified otherwise; the reported reconcile path moves to `.taskless/runtime/rules/<name>/check.ts` with the signature unchanged

## 4. ast-grep engine over the committed config

- [ ] 4.1 Update `rules/scan.ts` to run `sg scan --config .taskless/sg/sgconfig.yml --json=stream` and remove ephemeral `sgconfig.yml` generation from the check path
- [ ] 4.2 Update `rules/verify.ts` to run `sg test -c .taskless/sg/sgconfig.yml` over `sg/rule-tests/`
- [ ] 4.3 Tests: scan/verify run against the committed `sg/` config; `sg` binary-not-found prints an error and exits 1

## 5. Quality gates

- [ ] 5.1 `pnpm --filter @taskless/cli typecheck && lint && test` clean
- [ ] 5.2 Verify `check` output is identical before and after the relayout on a real `.taskless/` — same findings, same exit code. This change is a no-op to the user, so a difference is a regression
- [ ] 5.3 Update CLI help/onboarding text that names `.taskless/rules/` for the engine-partitioned layout, and `.taskless/.gitignore` handling
