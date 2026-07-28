## Why

Taskless rules run through one engine. `check` writes an ephemeral `sgconfig.yml` and runs `sg scan` over bare ast-grep YAML at `.taskless/rules/*.yml`; the runtime tier sits beside it at `.taskless/runtime-rules/`. Adding any second engine to that shape means either an in-file marker to say which engine owns a rule, or a generated config materialized at check time — both of which were tried and rejected in earlier designs.

This change makes the layout multi-engine **before** any second engine exists: rules partition by top-level directory, each holding that tool's own native, committed config. It ships no new engine and changes no behavior a user can observe — `check` finds and reports exactly what it did before, from a different path. That is the point: the relayout and the migration carry all the risk, so they land on their own where a regression has one obvious cause.

## What Changes

- Partition rules into `.taskless/<engine>/{config, rules/, rule-tests/}` — `sg/`, `vale/` (scaffolded empty), and `runtime/`. The containing directory determines the engine, so dispatch needs no per-file parsing.
- Make each engine's **committed native config** the source of truth, removing ephemeral `sgconfig.yml` generation from the check path. `check` runs `sg scan --config .taskless/sg/sgconfig.yml`.
- Add migration `0004`: move `rules/` → `sg/`, `rule-tests/` → `sg/rule-tests/`, `sgconfig.yml` → `sg/`, and `runtime-rules/` → `runtime/rules/` — content-preserving, so runtime capture hashes are unchanged. Scaffold `vale/`, `.gitkeep` every otherwise-empty directory, and bump the scaffold version.
- Gate on scaffold version: `runMigrations` throws when `taskless.json`'s `version` exceeds what the CLI knows, unless `--allow-version-mismatches` is passed.
- Write service-delivered rules into `sg/`. The delivery API carries no engine discriminator, so an engine-less payload is ast-grep by definition; an unrecognized engine fails loudly rather than defaulting.
- Keep dispatching the legacy `.taskless/rules/` path alongside `sg/rules/`, so an unmigrated checkout still runs and no producer has to cut over.

## Capabilities

### New Capabilities

- `cli-rule-format`: The engine-partitioned on-disk layout — `.taskless/<engine>/{config, rules/, rule-tests/}` with each engine's native committed config as the source of truth, directory-based dispatch, the migration that gets there, ingest defaulting, and legacy-layout tolerance. The extension point every future engine plugs into.

### Modified Capabilities

- `cli-check`: Check runs ast-grep against the committed `sg/sgconfig.yml` rather than generating one, and dispatches by engine directory. Because `generateSgConfig` leaves the check path, `check` calls `ensureTasklessDirectory` directly to preserve the migration trigger.
- `cli-runtime-rule-execution`: Runtime rules are discovered under `.taskless/runtime/rules/<name>/` instead of `runtime-rules/` — a directory move only; execution, reconcile, and signing semantics are untouched.

## Impact

- **CLI (`packages/cli`)**: new `filesystem/migrations/0004-*.ts`; `commands/check.ts` (engine-directory dispatch, migration trigger); `rules/scan.ts` and `rules/verify.ts` (`--config` over `sg/`); `rules/runtime/discover.ts` (new runtime path); `rules/files.ts` (ingest writes into `sg/`); removal of ephemeral `filesystem/sgconfig.ts` generation from the check path.
- **On-disk**: every existing `.taskless/` is relaid out by `0004` on first run. Content-preserving, so nothing needs re-signing or re-reconciling.
- **No new engine, no new binary, no user-visible behavior change.** `vale/` is scaffolded empty and nothing executes it yet.
- **Deliberately excluded**: the Vale engine itself and the engine-selection knowledge topic, which need this layout to exist first.
