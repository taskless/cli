## Context

See proposal.md for the motivation. The current state, by engine:

| Engine  | Fixtures                                   | Verdict                                                                                            | Same path as `check`?                  |
| ------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| runtime | `.tests/{pass,fail}/<case>/` directories   | `executeRuntimeRule(caseDir, rule)`                                                                | yes                                    |
| vale    | `.tests/{pass,fail}/<doc>` flat files      | `vale` under `buildIsolatingConfig`, which enables the rule under `[*]`                            | half: same binary, scope discarded     |
| sg      | `.tests/<id>-test.yml` `valid:`/`invalid:` | `sg test` for the verdict, then `scan --stdin` per snippet for findings (`sg-fixture-findings.ts`) | no: two mechanisms, neither is `check` |

`cli-vale-rule-engine` already requires that Vale verification "exercises the scope the rule actually declares". The `[*]` config does not, so part of this change brings the implementation into line with a requirement that was already standing.

Measured against ast-grep **0.51.0**, the version `main` pins, in a scratch tree:

| Setup                                                                               | Result                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------ |
| `scan -r rule.yml --no-ignore hidden .`, cwd = case, file at the `files:` glob path | fires                                      |
| same, file at the case root                                                         | silent: `files:` filtered it               |
| same, cwd = parent, case passed as a path                                           | silent: globs resolve against the cwd      |
| `--config <elsewhere>/sgconfig.yml` with an absolute `ruleDirs`, cwd = case         | fires: globs still resolve against the cwd |
| plain `tests/` inside a `ruleDirs` tree                                             | `Error: Cannot parse rule …/tests/…`       |
| `.tests/` inside a `ruleDirs` tree                                                  | skipped                                    |

And against Vale **3.24.0**, the pinned version, with `--config` in a separate directory:

| Setup                                          | Result                               |
| ---------------------------------------------- | ------------------------------------ |
| matcher `[docs/**/*.md]`, cwd = case, path `.` | only `docs/guide/x.md` fires         |
| same, cwd = parent, case passed as a path      | nothing fires                        |
| `[*]` or `[*.md]`, cwd = case                  | every `.md` fires                    |
| `[*]`, document under `.github/`               | fires: Vale walks hidden directories |

Both engines resolve scope against the working directory, so "cwd = case directory" means the same thing for each.

## Goals / Non-Goals

**Goals:**

- One fixture reader and one judging loop for every engine. An engine contributes only "run my check over this root for this rule".
- Fixtures exercise scope.
- The committed rules tree is never handed to ast-grep directly, so what a rule directory may contain does not depend on undocumented discovery behavior.

**Non-Goals:**

- Asserting position, message, or count. Fire / stay quiet is the whole test.
- Linting fixture style (unchanged: recipe guidance, never `verify`).
- Fixing the stale `cli-check` requirement "Check subcommand executes ast-grep scan", which still describes a committed `.taskless/sg/sgconfig.yml` the code stopped reading several migrations ago. Restating it here would hide a separate correction inside this change. Track it as its own fix.

## Decisions

### D1. A case is judged by the engine's real check, cwd = case directory

Each engine exposes `runCheck(rule, root) → findings` and nothing else. For ast-grep, that is `runSg` with `cwd: caseDir`, `configPath` pointing at a per-verification config in the run directory, and `ruleIds: [id]`. It is the same function `check` calls. For Vale, it is the Vale runner with cwd = case directory and a config built from the rule's own `.vale.ini` alone, with an absolute `StylesPath`. Not `assembleValeConfig({ ruleIds })`: that narrows what it writes but still validates every rule and refuses the whole assembly on any rejection, deliberately, for `check --rule`. Under verification that would let another rule's broken config fail this rule's cases. `validate` has already run on the rule under verification, so a one-rule config skips nothing. For runtime, it is `executeRuntimeRule(caseDir, rule)`, unchanged.

The shared loop in `rules/fixtures.ts` reads the buckets, runs each case, applies fail ≥1 / pass 0, classifies coverage, and attaches `bucket` to each finding.

_Alternatives:_ keep `sg test` for the verdict and adopt case directories only for findings. That keeps two mechanisms, which is the problem being fixed. A per-snippet `-r` stdin scan bypasses `files:` (measured), which defeats the goal.

### D2. ast-grep reads rules from a rules-only tree in the run directory

`assembleSgConfig` copies each rule's `<id>.yml` into `.taskless/.sg-rules/<id>.yml` beside the assembled `.sgconfig.yml`, and writes `ruleDirs` relative to it. `check` assembles against its snapshot, so for `check` the tree lands inside the run directory, which is per-run and swept (`cli-check`: "Each check run works in its own run directory"). For any other caller it is gitignored (migration 12 adds `/.sg-rules/`). Copied rather than symlinked, for Windows and because rule files are small.

Verification writes its own one-rule config and tree in a temporary directory, with an absolute `ruleDirs`, so the tree holds only the rule under verification. That gives the per-rule isolation the current `--filter` / single-rule config provides, so one bad `language:` elsewhere cannot abort the case.

_Alternatives:_

- One `-r` per rule in `check`: N full repository walks. Rejected.
- Keep `.tests/`: works today, but leaves the layout depending on undocumented discovery behavior that this repository pins with a vendor-contract test. It also leaves fixtures in a directory most tools hide.
- A multi-document `-r` file: one bad rule still aborts all, and it buys nothing over D2.

`ast-grep-vendor-contract.test.ts` keeps one assertion that a plain `tests/` inside `ruleDirs` fails. It now documents why D2 exists, not a behavior we rely on.

### D3. The unscoped diagnostic run

When a `fail/` case is quiet, run it once more without scope:

- **ast-grep:** a copy of the rule in the run directory with `files` and `ignores` removed, edited through the `yaml` document API that `sg-fixture-findings.ts` already uses, so formatting is irrelevant.
- **Vale:** today's `buildIsolatingConfig` (`[*]`), which survives exactly for this purpose.

The diagnostic run only selects the message. It never changes the verdict.

### D4. Migration 12 is a scaffold migration, and its converter is a shared module

The layout is what the scaffold version records (see the header of `rule-migrate.ts`), so this is `filesystem/migrations/0012-*`, not a rule-content migration. The conversion lives in `rules/fixture-convert.ts` so that migration 12 and delivery (D6) share it:

- **Language → extension:** a const table over the languages ast-grep 0.51.0 supports, keyed by ast-grep's own spelling. A vendor-contract test asserts the table covers the binary's language list, so a bump that adds a language fails there rather than in a user's migration.
- **Scope → path:** take the first `files:` glob, substitute `**/` → empty and `*` → the case name, and expand the first `{a,b}` alternative. Then check the result against `files` and `ignores` with `node:path`'s `matchesGlob`, which the Node floor (≥22.22) provides, so no glob dependency is added. Its dialect is close to ast-grep's `globset` but not identical, so the check catches derivation mistakes and is not a proof. The next `verify` is the proof, and D3 names the cause if they disagree. A rule with no `files:` gets `<case>.<ext>` at the case root. Vale does the same with the rule's enabling matchers. If the result fails its own check, the rule is left unconverted and named.
- **Case names:** `<bucket>-<NN>` in source order. Authors rename them to descriptions. The migration cannot invent one.

Migration 12 cannot run `verify`: scaffold migrations spawn no engines. Checking each derived path against the scope's own patterns is what stands in for that. A converted rule that still fails surfaces on the next `verify`, with D3's message pointing at the cause. This walks back an earlier idea of "report verdict changes after migrating": doing that would need the old verifier alive alongside the new one.

_Alternative:_ keep snippets in a single file per case named after the snippet's hash. Unreadable, and it buys nothing over ordinals.

### D5. The Vale 3.24 `tests:` rule migration writes the new layout

`rule-migrations/vale-3-24-0-tests-to-fixtures.ts` currently writes `.tests/<bucket>/<file>`. It changes to write `tests/<bucket>/<case>/<file>`, placing the document at a matcher-accepted path through the shared converter. Rule migrations run under `update --rules`, after scaffold migrations, so they always see the new layout.

### D6. Delivery migrates an old-format response just in time

Until the Cloud generator emits `tests/<bucket>/<case>/`, served v2 file sets carry fixtures under `.tests/`. Delivery treats `.tests/` as unsigned fixtures (as it does today), runs them through `fixture-convert.ts`, and writes the result under `tests/`. Fixtures are unsigned, so this changes no signed byte. Reconcile excludes both directories.

This is a permanent reading of the old format, not a transition shim. The CLI depends on no change from Cloud: the service can keep emitting `.tests/` for as long as it likes, and every CLI from this release on writes `tests/`. A served set already in the new layout passes through untouched. So the conversion is a no-op for whichever side moves first, and there is no rollout window to sequence.

### D7. Published surface

- `RULE_TESTS_DIRECTORY` becomes `"tests"`. `FixtureLayout` narrows to `"case-directories"`, and every `ENGINE_LAYOUTS` entry carries it. The type stays (not deleted), because the published `fixtureLayout` field is what a consumer reads and a later layout change would move.
- `reference.json` publishes a case list for every engine and increments its own `version`. Per CLAUDE.md, the artifact's version field is the compatibility signal, not the package version.

## Risks / Trade-offs

- [A fixture path matches a project `.gitignore` pattern, so the walker skips it and the case is quiet] → `check` would skip the same path, so the verdict is honest. D3's unscoped run walks the same way and also stays quiet, so the message would wrongly blame the pattern. Mitigation: the shared fixture section tells authors to avoid ignored directory names. If it bites in practice, a follow-up can detect "no file in this case was walked".
- [Authoring cost: scoped rules need path-mirrored fixtures] → Accepted. It is the price of testing scope, and the recipes teach it once.
- [Spawn cost: one process per case] → ast-grep starts in tens of milliseconds, and cases run concurrently with a small cap. Measure on this repository's rules during implementation and record it.
- [The scaffold bump makes a pinned older CLI refuse migrated projects] → Expected for a layout change. Call it out in the changeset body.
- [Derived glob paths are wrong for exotic globs] → Each derived path is checked against the same globs, and failures leave the rule untouched and named. Nothing is converted wrong in silence.

## Migration Plan

1. Land the stack on `main` with `gh stack merge` (see proposal, Delivery shape). The nightly publishes it. This repository's own `.taskless/rules/` migrate in the stack itself, so `pnpm cli check` keeps working throughout.
2. Release 0.13.4 when ready. Nothing is gated on Cloud (D6).
3. Tell Cloud about the new layout and the `reference.json` version through the collab artifact, so that they can move the generator when it suits them. No action is required of them.

Rollback: revert the stack. Migration 12 is forward-only like every scaffold migration, but it only moves unsigned fixtures, so a project on a reverted CLI fails with `SCAFFOLD_VERSION_MISMATCH` rather than misreading its rules.
