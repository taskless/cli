## Why

Taskless rules today are ast-grep only — structural AST matching that fits code but cannot lint prose. A large, wanted class of rules (terminology, banned/weasel words, inclusive language, readability, heading/style consistency) targets Markdown and prose, which ast-grep structurally cannot express: its text nodes are opaque, and it has no dictionaries, NLP, or code-vs-prose scoping. Vale is a mature, markup-aware prose linter that covers exactly this gap. This change makes the CLI multi-engine by partitioning rules **per engine directory**, each using the tool's own native, committed config — so engines never cross-parse one another's rules, hundreds of rules run without command-line limits, and `check` is pure execution.

## What Changes

- **Engine-top-down layout**: `.taskless/<engine>/` holds `{config, rules/, rule-tests/}` in that engine's native format — `sg/` (`sgconfig.yml` + native ast-grep rules) and `vale/` (`.vale.ini` + native Vale styles). Directory = engine; dispatch is which directory.
- **The native config is the source of truth — no sidecars, no generation at check time.** Each engine's committed config already carries everything: ast-grep rules scope via native `files`/`ignores` and hold Taskless data in `metadata`; Vale scopes via `.vale.ini` sections and (since Vale ignores unknown keys) carries Taskless breadcrumbs as `tskl) <name> = <value>` keys.
- **Vale scoping lives in `.vale.ini` matchers**: each `[<glob>]` section is a **matcher** — a globbable block whose parameters name which rule(s) run there (`rules.<name> = YES`/`NO`; enables union, disable wins), our `tskl)`-prefixed keys, and any other Vale config for that matcher. Styles live under `rules/` (Vale's required StyleName; `StylesPath = .`, `BasedOnStyles = rules`).
- **Check is pure execution over committed configs**: `sg scan --config sg/sgconfig.yml` / `vale --config vale/.vale.ini` — no materialization, no sidecar reads, no config generation, nothing to cache.
- **Verify works differently from check** (both engines isolate each rule against known fixtures): `sg test` runs ast-grep's native tests; the Vale verifier **generates a temporary `.vale.ini`** to test each rule against its `pass/`/`fail/` fixtures.
- **Add Vale as a static-tier engine**: always-run, anonymous-safe, no reconcile/signing. Vale's Tengo `script` is sandboxed (only `text`/`math`/`fmt`; no `os`/`io`/`exec`) — not a code-execution vector — so it stays static; a subprocess timeout bounds it.
- **Realign runtime to the same shape**: move `runtime-rules/ → runtime/rules/` and `runtime-rule-tests/ → runtime/rule-tests/` (content-preserving — no live users, hashes stable). Runtime _execution_ (harness/reconcile/signing) is unchanged; only the directory and `discover.ts`'s search path move.
- **Ship as migration `0004`** on the existing `runMigrations` ladder — moves `rules/`/`rule-tests/`/`sgconfig.yml` under `sg/`, scaffolds `vale/`, and moves the runtime dirs under `runtime/`. No new `upgrade` command; `runMigrations` gains version-mismatch gating (throw + `--allow-version-mismatches`).

## Capabilities

### New Capabilities

- `cli-rule-format`: The engine-top-down on-disk layout — `.taskless/<engine>/{config, rules/, rule-tests/}` with each engine's native, committed config as the source of truth (no sidecars, no generated config). Directory-based dispatch; the extension point for future engines.
- `cli-vale-rule-engine`: Vale as a concrete static engine — static-tier trust (sandboxed Tengo), the `.vale.ini` **matcher** scoping model (per-`[<glob>]` enable/disable + `tskl)` keys) and StyleName mapping, the `--config` check runner, a **verify that generates a temporary `.vale.ini`** per rule against `pass/`/`fail/` fixtures, and findings→`CheckResult` mapping (incl. `rules.` prefix stripping).

### Modified Capabilities

- `cli-check`: Check runs each engine's native tool with its committed config (`sg scan --config sg/…`, `vale --config vale/…`) over the resolved paths, concurrently, and merges results; verify runs `sg test` (ast-grep) and a Vale fixture runner. The ephemeral `sgconfig.yml` generation is removed from the check path (configs are committed under `sg/`), and `check` calls `ensureTasklessDirectory` directly to preserve the migration trigger.
- `cli-runtime-rule-execution`: Runtime rules are discovered under `.taskless/runtime/rules/<name>/` (and fixtures under `runtime/rule-tests/<name>/`) instead of `runtime-rules/` — a directory move only; execution semantics are unchanged.

## Impact

- **CLI (`packages/cli`)**: `commands/check.ts` (per-engine execution over committed configs + migration trigger), `rules/scan.ts` (`--config` over `sg/`), `rules/verify.ts` (`sg test` over `sg/`), new `rules/vale/*` (`--config` runner, `CheckResult` mapping, fixture verify), removal of ephemeral `filesystem/sgconfig.ts` generation from the check path, new `filesystem/migrations/0004-*.ts`.
- **On-disk layout**: `.taskless/sg/{sgconfig.yml, rules/, rule-tests/}` and `.taskless/vale/{.vale.ini, rules/, rule-tests/}`; legacy bare `.taskless/rules/*.yml` migrate under `sg/`. `taskless.json` scaffold version bumps.
- **Dependency**: adds `vale` as an external binary the CLI shells out to (like `sg`).
- **Runtime execution unchanged** (reconcile/signing/harness) — only the directory moves `runtime-rules/ → runtime/rules/` (updating `discover.ts`'s path); Vale is explicitly static. **No new `upgrade` command** — the migration ladder suffices (now with version-mismatch gating).
- **Downstream (separate change, taskless repo)**: generating Vale rules + authoring the committed `.vale.ini`/`sgconfig.yml`, the verification-sandbox path, and prose-request classification build on this foundation.
