## 1. Migration and directory layout

- [ ] 1.1 Add `filesystem/migrations/0004-vale-engine.ts`: move `.taskless/rules/`, `rule-tests/`, and `sgconfig.yml` under `.taskless/sg/` (content-preserving; `ruleDirs: [rules]` is relative and stays valid)
- [ ] 1.2 Extend `0004` to move `.taskless/runtime-rules/ → runtime/rules/` and `runtime-rule-tests/ → runtime/rule-tests/` byte-for-byte (runtime hashes unchanged)
- [ ] 1.3 Extend `0004` to scaffold `.taskless/vale/` (`.vale.ini` + `rules/` + `rule-tests/`), writing a `.gitkeep` into every otherwise-empty scaffolded directory, and bump `taskless.json` `version`
- [ ] 1.4 Register `0004` in `filesystem/migrate.ts` and confirm `runMigrations` applies it via `ensureTasklessDirectory`
- [ ] 1.5 Add version-mismatch gating: `runMigrations` throws when `taskless.json.version > maxVersion` with an "upgrade the CLI" message, unless a global `--allow-version-mismatches` flag is set
- [ ] 1.6 Tests: `0004` moves each tree correctly, `.gitkeep` present, runtime contents byte-identical; gating throws and the flag overrides

## 2. Engine dispatch (directory model)

- [ ] 2.1 Implement directory-based engine discovery: enumerate `.taskless/<engine>/` (`sg`, `vale`, `runtime`) and route rules by directory, no per-file parsing
- [ ] 2.2 In `commands/check.ts`, call `ensureTasklessDirectory(cwd)` directly (preserving the migration trigger now that `generateSgConfig` leaves the check path)
- [ ] 2.3 Tests: a rule under `sg/rules/` dispatches to ast-grep and one under `vale/rules/` to Vale, by directory alone

## 2b. Service-delivered rule ingest

- [ ] 2b.1 Update `rules/files.ts` — `writeRuleFile` writes `.taskless/sg/rules/<id>.yml` and `writeRuleTestFile` writes `.taskless/sg/rule-tests/`, replacing the hardcoded `.taskless/rules` / `.taskless/rule-tests` (both call sites are `commands/rules.ts:241,245,482,486`)
- [ ] 2b.2 Resolve the destination from an engine the payload identifies, defaulting to `sg` when the payload identifies none — permanently, since the API carries no engine discriminator today
- [ ] 2b.3 Fail loudly on an engine the CLI does not recognize: error naming the engine, instruct upgrade, write nothing (do NOT fall back to `sg`)
- [ ] 2b.4 Audit the remaining `.taskless/rules` string literals for the same defect — at minimum `rules/verify.ts:246`, `rules/files.ts:99`, `commands/check.ts:314`, `commands/rules.ts:661`, and the `detect/scan.ts:428` layout probe
- [ ] 2b.5 Tests: an engine-less payload lands in `sg/rules/` and is dispatched to ast-grep by `check`; a migrated rule and a freshly delivered one come to rest at the same path; an unrecognized engine errors and writes nothing

## 2c. Reconcile compatibility

- [ ] 2c.1 Confirm reported reconcile paths follow the moved trees (`rules/runtime/run-set.ts:57` builds repo-relative POSIX paths from the discovered location)
- [ ] 2c.2 Test: after `0004`, signatures are unchanged and the signature-based join resolves every moved rule — nothing reports as new or missing

## 3. Runtime discovery path

- [ ] 3.1 Update `rules/runtime/discover.ts` to read `.taskless/runtime/rules/<name>/` and fixtures from `runtime/rule-tests/<name>/` (was `runtime-rules/`)
- [ ] 3.2 Confirm rules under `.taskless/sg/rules/` are treated as static, not runtime
- [ ] 3.3 Tests: runtime discovery at the new path; execution/reconcile/signing behavior unchanged

## 4. ast-grep engine over the committed config

- [ ] 4.1 Update `rules/scan.ts` to run `sg scan --config .taskless/sg/sgconfig.yml --json=stream` and remove ephemeral `sgconfig.yml` generation from the check path
- [ ] 4.2 Update `rules/verify.ts` to run `sg test -c .taskless/sg/sgconfig.yml` over `sg/rule-tests/`
- [ ] 4.3 Tests: scan/verify run against the committed `sg/` config; `sg` binary-not-found prints an error and exits 1

## 5. Vale engine

- [ ] 5.1 Add `rules/vale/binary.ts`: resolve the `vale` binary; when absent, report the Vale engine unavailable without aborting other engines
- [ ] 5.2 Add `rules/vale/run.ts`: run `vale --config .taskless/vale/.vale.ini --output=JSON --no-exit <paths>`, bounded by a subprocess timeout that terminates and reports on expiry
- [ ] 5.3 Map Vale JSON findings → `CheckResult`: `source: "vale"`, `ruleId` = check name with `rules.` stripped, severity `error/warning/suggestion → error/warning/hint`, and `message`/`note`/`range`/`matchedText`/`fix` per the mapping
- [ ] 5.4 Add `rules/vale/verify.ts`: for each `vale/rule-tests/<rule>/`, generate an ephemeral `.vale.ini` enabling only that rule, run Vale over `pass/`/`fail/` fixtures, assert every `fail/` yields a finding and every `pass/` none
- [ ] 5.5 Tests: `rules.` stripping + severity mapping; committed-config scoping respected (include union, exclude disable, duplicate matchers merge); verify pass/fail; missing-binary and timeout paths

## 6. Check orchestration

- [ ] 6.1 Dispatch to distinct executors by engine directory — ast-grep (`sg/`) → scanner, Vale (`vale/`) → runner, runtime (`runtime/rules/`) → harness
- [ ] 6.2 Run engines concurrently, merge `CheckResult`s into one set, derive the exit code from merged severities, and keep an unavailable engine from aborting the others
- [ ] 6.3 Tests: a mixed `sg`+`vale`+`runtime` corpus runs all executors and merges; with the `vale` binary absent, ast-grep results still return

## 7. Quality gates

- [ ] 7.1 `pnpm --filter @taskless/cli typecheck && lint && test` clean
- [ ] 7.2 Update CLI help/onboarding text and `.taskless/.gitignore` handling for the engine-partitioned layout
