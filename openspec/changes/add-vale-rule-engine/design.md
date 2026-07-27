## Context

Taskless rules run today through one engine, ast-grep: `commands/check.ts` writes an ephemeral `sgconfig.yml` (`ruleDirs: [rules]`) and runs `sg scan --config … --json=stream`; rules live as bare ast-grep YAML at `.taskless/rules/*.yml`. A separate **runtime** tier (`runtime-rules/<name>/`: capture YAML + signed `check.ts`) runs only after an authenticated server reconcile. A `.taskless/` migration system exists (`filesystem/migrate.ts`→`runMigrations`, keyed on `taskless.json`'s `version`, invoked via `ensureTasklessDirectory`).

We add **Vale**, a markup-aware prose linter, because ast-grep can't lint prose. The design was derived empirically against `vale 3.15.1` and `sg 0.41.0`; the facts that shaped it:

- **Each tool already has a native, committed config that expresses everything we need** — ast-grep: a rule's native `files`/`ignores` scope it, `metadata` holds extra data; Vale: a `.vale.ini` **matcher** (a `[<glob>]` section) scopes rules by path glob and, because Vale accepts and silently ignores unknown keys, holds arbitrary Taskless data _within that matcher_. So Taskless needs **no separate metadata/sidecar layer** — each engine's own config is the source of truth.
- **Vale `.vale.ini` scoping composes cleanly and predictably** (all verified): `[<glob>] Style.Rule = YES` enables a rule for a path (no `BasedOnStyles` needed); overlapping enables **union**; `[<glob>] Style.Rule = NO` **disables** and wins over an enable, order-independent; globs support brace alternation with slashes (`[{marketing/**,docs/**}]`) and whole-section negation (`[!x]`). So arbitrary per-rule include/exclude lives in the `.ini` itself.
- **Vale requires a StyleName directory level** (`StylesPath/<Style>/<rule>.yml`) — a flat rule errors `E100 style does not exist`; a `rules/` dir _is_ that StyleName.
- **Both tools read rules from disk via `--config` with no size ceiling** — so committed per-engine configs scale to hundreds of rules where `--inline-rules` (`ARG_MAX`) and `sg --rule` (single file) can't.

The result: engines are partitioned **by top-level directory**, each holding its tool's native, **committed** config + rules + tests. Check is pure execution — no sidecars, no materialization, no generation, nothing to cache.

## Goals / Non-Goals

**Goals:** add Vale as a second **static-tier** engine; store each engine's rules + config in its own directory using the tool's native format; make `check`/`verify` pure execution over committed configs (zero construction); ride the existing migration ladder.

**Non-Goals:** generating Vale rules and authoring the committed configs — split across **two downstream changes**: a CLI-side change (the `taskless/skills` rule-authoring commands that _write_ `.vale.ini`/`sgconfig.yml`) and a `taskless`-repo change (server rule generation + prose-request classification). Also out of scope: changing runtime _execution_ (harness/reconcile/signing are untouched — only the runtime directory moves); restricting Vale's feature set (Tengo `script` is sandboxed — D7).

## Directory layout (target)

```
.taskless/
  sg/       sgconfig.yml            rules/<rule>.yml            rule-tests/<name>.yml
  vale/     .vale.ini               rules/<rule>.yml            rule-tests/<name>.yml
  runtime/  rules/<rule>/{<capture>.yml, check.ts}   rule-tests/<rule>/<fixture>/
  taskless.json
```

This change implements all three: `sg/`, `vale/`, and the `runtime/` realignment (safe now — no one uses runtime rules yet, and the move is content-preserving so runtime hashes are unaffected). Every scaffolded directory (each engine dir and its `rules/`/`rule-tests/`) carries a `.gitkeep` so the structure is tracked reliably even when empty.

## Decisions

### D1 — Engines partition by top-level directory; each holds a native, committed config

`.taskless/<engine>/` contains `{config, rules/, rule-tests/}` in that engine's native format. Directory = engine (dispatch is which dir, no parsing); the config is **committed and persisted**, not generated. This is what makes `check` construction-free and sidesteps cross-parse (Vale's StylesPath never sees `.sg.yml`).

- **Why not co-located rules + a sidecar/envelope** (earlier designs): every co-located approach forced either an in-file marker Vale rejects (`E201`) or a generated config + materialization at check time. Per-engine native configs delete that entire layer — the tool's own config already carries scoping and (via ignored keys / `metadata` / comments) any Taskless breadcrumbs.

### D2 — The native config is the source of truth; no sidecars, no generation at check time

- **ast-grep** (`sg/`): `sgconfig.yml` (`ruleDirs: [rules]`, `testConfigs: [{testDir: rule-tests}]`) + native rule files whose `files`/`ignores` scope them and `metadata` holds Taskless data.
- **Vale** (`vale/`): `.vale.ini` (`StylesPath = .`, `BasedOnStyles = rules`, per-rule scoping sections, plus Taskless breadcrumbs as `tskl) <name> = <value>` keys — Vale's ini parser accepts and silently drops them, verified) + native styles under `rules/` (the StyleName). Vale check names are `rules.<name>`, normalized to `ruleId = <name>`. ast-grep, by contrast, carries any Taskless data in its native `metadata` field.

Construction of these configs happens at **rule-authoring time** (the downstream generator, or a human editing a committed config) — never at check time.

### D3 — Scoping is native per engine

- **ast-grep** — a rule's `files` (include) / `ignores` (exclude), verified to path-scope an inline/config rule.
- **Vale** — each `.vale.ini` **matcher** (a `[<glob>]` section) scopes by path and lists which rules run there: include = `rules.<name> = YES` (enables union across matchers), exclude = `rules.<name> = NO` (disable wins). Deterministic and order-independent (verified), so generation is a straight emit of YES/NO matchers — no cascade to reason about.

**Repeat matchers are allowed and merge** — Vale unions duplicate `[<glob>]` headers (verified: `[*.md]` twice fired both rules). Because one rule's scoping can therefore be scattered across several matchers, each Taskless-owned matcher carries a `tskl) rule = <id>` breadcrumb naming its owning rule — a **canonical id** so tooling can find and update the right rule's matchers later rather than guessing from globs.

### D4 — Vale layout maps to StylesPath via the `rules/` StyleName

`.vale.ini` lives at `.taskless/vale/.vale.ini` with `StylesPath = .`, so `.taskless/vale/rules/` is the required StyleName directory (`BasedOnStyles = rules`). Styles are pure-native Vale files; the `rules.` check-name prefix is stripped for `ruleId`. (Flat rules without the StyleName level fail — verified.)

### D5 — Check and verify are pure execution over committed configs

`check` runs each engine's tool with its committed config over the resolved paths, concurrently, and merges `CheckResult`s — **no materialization, no sidecar reads, no config generation, nothing to cache**:

- ast-grep — `sg scan --config .taskless/sg/sgconfig.yml <paths> --json=stream`.
- Vale — `vale --config .taskless/vale/.vale.ini <paths> --output=JSON --no-exit`.

`verify` likewise runs native runners: `sg test -c .taskless/sg/sgconfig.yml` (ast-grep's native tests, matched by rule `id`), and a Vale **fixture runner** over `.taskless/vale/rule-tests/<rule>/` — a per-rule subdirectory of `pass/` and `fail/` fixture documents. Because verify is one-time (not per-check), the isolating `.vale.ini` (StylesPath + only that rule enabled) is **generated** at verify time rather than committed; conceptually this mirrors ast-grep's `valid`/`invalid` (pass/fail), asserting every `fail/` fixture yields a finding and every `pass/` fixture none. Because `generateSgConfig` no longer runs on the check path, `check` calls `ensureTasklessDirectory` directly to preserve the migration trigger.

### D6 — Vale runs in the static tier, unmodified, bounded by a subprocess timeout

Vale's Tengo `script` sandbox exposes only `text`/`math`/`fmt` (verified: `os`/`io`/`exec` → "module not found"), so a Vale rule can't reach the host — trust equals ast-grep static. Vale is always-run, anonymous-safe, no reconcile/signing; a subprocess timeout bounds a runaway Tengo loop. Vale is used as-is.

### D7 — One scaffold version in `taskless.json`; migration `0004` reorganizes into `sg/` + `vale/`

`taskless.json.version` is the single format version. Migration `0004-*` is a **mechanical move**: the existing `.taskless/rules/` and `rule-tests/` are all known-ast-grep, so it moves `rules/ → sg/rules/`, `rule-tests/ → sg/rule-tests/`, and `sgconfig.yml → sg/sgconfig.yml` — and because `ruleDirs: [rules]` is _relative to the config_, it survives the move unchanged (no path edits). It then scaffolds `vale/` (`.vale.ini` + `rules/` + `rule-tests/`) and moves the runtime tier into the same shape: `runtime-rules/<name>/ → runtime/rules/<name>/` and `runtime-rule-tests/<name>/ → runtime/rule-tests/<name>/`. The runtime move is content-preserving — capture-rule bytes (and thus their reconciliation hashes) are unchanged; only `discover.ts`'s search path updates. Legacy bare rules keep working (they become `sg/` rules). **Version gating:** `runMigrations` currently returns silently when `version > maxVersion`; change it to **throw** ("upgrade the CLI") unless `--allow-version-mismatches` is passed.

### D7b — Ingest defaults an engine-less payload to `sg`, permanently; unrecognized fails loudly

`0004` relayouts what is already on disk, but the **ingest** path writes rules that arrive from the service, and it is a separate hazard: `writeRuleFile`/`writeRuleTestFile` (`rules/files.ts:11,26`) hardcode `.taskless/rules` and `.taskless/rule-tests`. Left untouched, the migration would move existing rules to `sg/` and the next `taskless rule create` would write straight back into `.taskless/rules/` — a directory no engine dispatches from under D1. Silent, and it reads as a vanished rule.

The API offers nothing to switch on: there is no `engine`, `analysisType`, or `ruleType` field anywhere in `src/generated/api.d.ts`, and `/cli/api/rule/{ruleId}` documents `rules[].content` as "The ast-grep rule definition". The `filename` fields that do exist are **client→server** (`references[].filename` on `rule improve`; `files[].file` on reconcile) — the CLI tells the service where things live, not the reverse. So the CLI owns the destination decision, and today every delivered rule is ast-grep.

Hence: **no engine identified ⇒ `sg`**, and permanently rather than for a migration window — published CLIs keep receiving engine-less payloads. This is the same judgment `0004` makes about on-disk state, so ingest and migration land a rule in the same place.

**Absence and unrecognized are not the same.** An unrecognized engine means the payload is newer than the CLI; falling back to `sg` would file a Vale rule where ast-grep parses it, surfacing as a broken rule rather than version skew. Ingest errors and writes nothing, mirroring D7's scaffold-version gating. Server-side, the existing `x-taskless-cli-version` header (`api/client.ts`) lets the service avoid sending engine-typed payloads to a CLI that predates them; that half is the platform's.

- **Alternative — sniff the rule body to guess its engine:** rejected; contradicts D1 (directory decides engine, no per-file parsing) and guesses where an explicit default is correct and knowable.

### D7c — Reconcile is path-independent, so the relayout is transparent

Reported reconcile paths are repo-relative POSIX and derived from wherever a rule was discovered (`rules/runtime/run-set.ts:57`), so they follow the moved trees automatically. The server joins reported files **by content signature, not path** — "content-based, so a moved-but-unchanged rule resolves" — and `0004` is byte-preserving. A migrated rule therefore reconciles to the same server-side rule with no coordinated release. The schema description "Delivered rule filename under `.taskless/rules/` on the client" goes stale on the platform side and is worth a follow-up there, but nothing depends on it.

### D8 — Metadata surfaces through `CheckResult`; identity from the rule name

`CheckResult { source, ruleId, severity, message, note, file, range, matchedText, fix }` is the contract each engine maps into. `ruleId` is the rule's basename (ast-grep native `id`; Vale's `rules.<name>` stripped to `<name>`). Severity is engine-native, normalized on the client — Vale `error/warning/suggestion → error/warning/hint` (`info` unused; `.vale.ini` sets `MinAlertLevel = suggestion`). Vale mapping: `message←Message`, `note←Description/Link`, `range←Line+Span`, `matchedText←Match`, `fix←Action` when populated. Provenance is a generation-time server wrapper, never on disk.

## Risks / Trade-offs

- **Committed configs are maintained artifacts** — the `.vale.ini` scoping sections and native `files`/`ignores` must be authored/updated when rules change. Construction doesn't vanish; it moves to rule-authoring time (mostly the downstream generator). Trade: check-time simplicity + transparent, versioned configs for author-time maintenance.
- **Per-engine (not uniform) metadata** — fine for check (findings carry the rule name); any "list/describe rules" tooling parses each engine's native format.
- **Vale `StyleName = rules`** yields `rules.<name>` internally → stripped for `ruleId`; keep the strip consistent.
- **Losing auto-migration when `generateSgConfig` leaves check** → `check` calls `ensureTasklessDirectory` directly (D5).
- **Vale DoS (runaway Tengo)** → subprocess timeout (D6).
- **New `vale` binary dependency** → shell out like `sg`; degrade clearly if absent.
- **Hardcoded `.taskless/rules` literals outside the ingest writer** — `rules/verify.ts:246`, `rules/files.ts:99`, `commands/check.ts:314`, `commands/rules.ts:661`, and the `detect/scan.ts:428` layout probe all name the pre-migration path. Each is the same class of defect as the ingest writer and is audited in task 2b.4; a missed one silently reads or writes outside the engine directories.
- **Runtime realignment** → `runtime-rules/ → runtime/rules/` moves the directory only; execution (harness/reconcile/signing) and capture-rule content are untouched, so hashes are stable. Safe now because runtime rules have no live users; the downstream generator's write path updates separately.

## Migration Plan

`migrations/0004-vale-engine.ts`: bump the scaffold version; move `rules/`, `rule-tests/`, `sgconfig.yml` under `sg/`; scaffold `vale/`; move `runtime-rules/ → runtime/rules/` and `runtime-rule-tests/ → runtime/rule-tests/`. Back-compat — legacy rules become `sg/` rules unchanged; runtime content is byte-identical after the move. On the next `check`/`verify`, `runMigrations` applies it. Rollback is safe until a `vale/` rule exists; thereafter a Vale-aware CLI is required (version gating makes that explicit).

## Open Questions

_None outstanding._ The three revisited items are resolved: Vale rule-tests use per-rule `pass/`/`fail/` subdirectories with a verify-time-**generated** isolating `.vale.ini` (mirroring ast-grep's valid/invalid); Taskless breadcrumbs in `.vale.ini` use the `tskl) <name> = <value>` namespace (all namespaced key syntaxes verified tolerated); and the runtime tier is **realigned** to `runtime/` in this change (content-preserving move).

All hard mechanisms are verified against `vale 3.15.1` / `sg 0.41.0`: native-config scoping, `.vale.ini` enable/disable composition, StyleName requirement, `--config` scale path, ignored `tskl)` keys, Vale sandbox.
