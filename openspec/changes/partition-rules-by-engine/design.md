## Context

Taskless rules run today through one engine, ast-grep: `commands/check.ts` writes an ephemeral `sgconfig.yml` (`ruleDirs: [rules]`) and runs `sg scan --config … --json=stream`; rules live as bare ast-grep YAML at `.taskless/rules/*.yml`. A separate **runtime** tier (`runtime-rules/<name>/`: capture YAML + signed `check.ts`) runs only after an authenticated server reconcile. A `.taskless/` migration system already exists (`filesystem/migrate.ts` → `runMigrations`, keyed on `taskless.json`'s `version`, invoked via `ensureTasklessDirectory`).

That shape has room for exactly one engine. Every co-located alternative explored earlier forced either an in-file marker saying which engine owns a rule, or a generated config materialized at check time. Partitioning by directory removes the question: the path _is_ the answer.

Two facts, verified against `sg 0.41.0` and `vale 3.15.1`, make committed per-engine configs viable:

- **Each tool's native config already expresses everything needed.** ast-grep scopes a rule with its own `files`/`ignores` and carries extra data in `metadata`. Vale scopes via `.vale.ini` matchers and silently ignores unknown keys. So Taskless needs **no sidecar or metadata layer** of its own.
- **Both read rules from disk via `--config` with no size ceiling** — where `--inline-rules` (`ARG_MAX`) and `sg --rule` (one file) cannot scale to hundreds of rules.

## Goals / Non-Goals

**Goals:** partition rules by engine directory; make each engine's committed native config the source of truth; remove config generation from the check path; ride the existing migration ladder; keep every observable behavior identical.

**Non-Goals:** adding the Vale engine (it needs this layout first) and the engine-selection knowledge topic. Also excluded: changing runtime _execution_ — the harness, reconcile, and signing are untouched, only the directory moves; and authoring the committed configs, which belongs to rule generation.

## Directory layout (target)

```
.taskless/
  sg/       sgconfig.yml            rules/<rule>.yml            rule-tests/<name>.yml
  vale/     .vale.ini               rules/<rule>.yml            rule-tests/<name>.yml
  runtime/  rules/<rule>/{<capture>.yml, check.ts}   rule-tests/<rule>/<fixture>/
  taskless.json
```

All three land here. `vale/` is scaffolded but inert — no engine reads it until the Vale change. The `runtime/` realignment is safe now precisely because nothing uses runtime rules yet, and the move is content-preserving so hashes are unaffected. Every scaffolded directory carries a `.gitkeep` so the structure tracks reliably when empty.

## Decisions

### D1 — Engines partition by top-level directory

`.taskless/<engine>/` holds `{config, rules/, rule-tests/}` in that engine's native format. **Directory = engine**: dispatch reads the path, never the file. The config is committed and persisted, not generated.

This is what makes `check` construction-free, and it sidesteps cross-parsing entirely — one engine's config directory never sees another's rule files.

- **Alternative — co-located rules plus a sidecar or envelope:** rejected. Every variant forced either an in-file marker (which Vale rejects outright, `E201`) or a generated config materialized at check time. Per-engine native configs delete that layer rather than manage it.

### D2 — The native config is the source of truth; nothing is generated at check time

`sg/sgconfig.yml` declares `ruleDirs: [rules]` and `testConfigs: [{testDir: rule-tests}]`; rule files carry their own `files`/`ignores` scoping and any Taskless data in native `metadata`. Construction of these configs happens at **rule-authoring time** — by the generator, or by a human editing a committed file — never during a check.

Because `generateSgConfig` no longer runs on the check path, `check` calls `ensureTasklessDirectory` directly so the migration still triggers. That is easy to drop and would silently strand users on an old layout.

### D3 — Migration `0004` is a mechanical, content-preserving move

The existing `.taskless/rules/` and `rule-tests/` are all known-ast-grep, so `0004` moves them under `sg/` without editing contents. `sgconfig.yml`'s `ruleDirs: [rules]` is **relative to the config**, so it survives the move unchanged — no path rewriting. It then scaffolds `vale/` and moves the runtime tier into the same shape.

Content preservation is not incidental: runtime capture bytes determine their reconciliation hashes, so editing during the move would invalidate every signature. Only `discover.ts`'s search path changes.

**Version gating:** `runMigrations` currently returns silently when `version > maxVersion`. It changes to **throw** ("upgrade the CLI") unless `--allow-version-mismatches` is passed, so a newer scaffold fails loudly instead of being half-read by an older CLI.

### D4 — Service-delivered rules default to `sg`, permanently

The ingest path is a separate hazard from the migration: `writeRuleFile`/`writeRuleTestFile` (`rules/files.ts`) hardcode `.taskless/rules`. Left alone, `0004` would relayout existing rules under `sg/` while the next `rule create` wrote straight back into a directory no engine dispatches from — silent, and it reads as a vanished rule.

The API offers nothing to switch on: there is no `engine`, `analysisType`, or `ruleType` field anywhere in `src/generated/api.d.ts`, and `/cli/api/rule/{ruleId}` documents `rules[].content` as "The ast-grep rule definition". The `filename` fields that exist are **client→server** (`references[].filename` on `rule improve`; `files[].file` on reconcile) — the CLI tells the service where things live, not the reverse.

So **no engine identified ⇒ `sg`**, permanently rather than for a migration window, since published CLIs keep receiving engine-less payloads. This is the same judgment `0004` makes about on-disk state, so ingest and migration land a rule in the same place.

**Absence and unrecognized are not the same.** An unrecognized engine means the payload is newer than the CLI; defaulting would file it where the wrong parser reads it, surfacing as a broken rule rather than version skew. Ingest errors and writes nothing.

- **Alternative — sniff the rule body to guess its engine:** rejected; contradicts D1 and guesses where an explicit default is correct and knowable.

### D5 — Both layouts stay readable, so no producer has to cut over

The CLI dispatches the legacy `.taskless/rules/` path as ast-grep alongside `sg/rules/`, de-duplicating when both exist. An unmigrated checkout still runs, and a service that keeps naming the old location keeps working.

This is what decouples this change's release from anyone else's: there is no coordinated cutover, and no window in which a rule silently stops being checked.

### D6 — Reconciliation is path-independent, so the relayout is invisible to the server

Reported reconcile paths are repo-relative POSIX and derived from wherever a rule was discovered (`rules/runtime/run-set.ts`), so they follow the moved trees automatically. The server joins reported files **by content signature, not path** — "content-based, so a moved-but-unchanged rule resolves" — and `0004` is byte-preserving. A migrated rule therefore reconciles to the same server-side rule with no coordinated release.

The API schema's description "Delivered rule filename under `.taskless/rules/` on the client" goes stale when this lands. That is cosmetic and belongs to the platform side; nothing depends on it.

## Risks / Trade-offs

- **Losing the migration trigger when `generateSgConfig` leaves the check path** → `check` calls `ensureTasklessDirectory` directly (D2), and that is worth a test rather than a comment.
- **Hardcoded `.taskless/rules` literals beyond the ingest writer** — `rules/verify.ts`, `rules/files.ts`, `commands/check.ts`, `commands/rules.ts`, and the `detect/scan.ts` layout probe all name the pre-migration path. Each is the same defect class; a missed one silently reads or writes outside the engine directories.
- **A partial migration leaves a split-brain `.taskless/`** → `0004` moves whole trees and the legacy path stays readable (D5), so a half-applied state still checks rules rather than dropping them.
- **Committed configs are maintained artifacts** — scoping now lives in files a human or generator edits, rather than being reconstructed each run. That is the trade: check-time simplicity for author-time maintenance.

## Migration Plan

`0004` runs on first `ensureTasklessDirectory` after upgrade, which `check` triggers. No user action. Rollback is a CLI downgrade plus moving `sg/rules/` back to `rules/` — but the legacy path stays readable, so an old CLI against a new layout degrades to finding no rules rather than erroring, and a new CLI against an old layout still works.

## Open Questions

None outstanding. The engine-selection knowledge topic and the Vale engine are deliberately deferred to the change that adds Vale, since both name engines this change only scaffolds.
