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

### D6b — The CLI resolves the Vale binary itself; how it is delivered stays open

Two separable concerns. **Resolution** — where the CLI looks — is settled here. **Delivery** — how the binary arrives — is deliberately not, because the resolution code is identical either way and nothing downstream depends on the answer.

Resolution follows the pattern **already in production for ast-grep**: `findSgBinary()` (`rules/scan.ts:38-61`) resolves the platform package from our own module context with `createRequire(import.meta.url).resolve('<pkg>/package.json')`, execs the binary beside it, and falls back to `PATH`. Vale gets the same shape; the two should share one helper rather than diverge.

That code exists because the upstream postinstall already failed here: its comment records that `@ast-grep/cli`'s hardlink step breaks under `pnpm dlx`'s strict dependency isolation, **leaving a placeholder text file where the binary should be**. Resolving the platform package ourselves sidesteps the lifecycle script entirely — nothing to approve, nothing a package-manager policy can block, nothing to fail silently.

Order: **platform package → `PATH` → a clear "Vale engine unavailable" report** that leaves the other engines running (D6).

Delivery is **per-platform npm packages carrying the binary in the tarball**, declared as `optionalDependencies` filtered by `os`/`cpu`, so exactly one matching package installs (verified: only `@ast-grep+cli-darwin-arm64` is present in this repo's store, shipping `ast-grep` at mode `-rwxr-xr-x` — the executable bit survives the npm tarball). Vale is MIT; redistribution needs attribution and nothing more.

Note this is ast-grep's _packaging_ without ast-grep's _installation_: upstream ships the binary in a platform package **and** hardlinks it into place via postinstall, because it exposes `bin: {sg, ast-grep}` for humans. We never need that copy — we exec Vale as a subprocess with an explicit path — so the packages need no `bin`, no scripts, and no install-time step of any kind.

Vale is load-bearing, and that is what settles it. An engine the product depends on cannot have its availability decided by install-time network access, an upstream project's release hosting, or a policy set in the consumer's repository.

The decisive comparison is **binary-in-tarball vs. download-at-postinstall**, not who publishes it. Against the only existing npm distribution, `@vvago/vale` (maintainer `zeropaper`, not the Vale project), which ships a `postinstall` that fetches the release archive (deps `tar`/`unzipper`/`rimraf`):

| Property                                 | postinstall-download | binary-in-tarball |
| ---------------------------------------- | -------------------- | ----------------- |
| Binary covered by an npm integrity hash  | no                   | yes               |
| Pinned by the consumer's lockfile        | no                   | yes               |
| Resolves offline / via a registry mirror | no                   | yes               |
| Requires lifecycle scripts to be enabled | yes                  | no                |

The last row is not a preference. pnpm 10 does not run dependency lifecycle scripts without an `onlyBuiltDependencies` allowlist, and that script would execute during a **consumer's** install under a policy we cannot set — allowlisting it here changes nothing for them. `npx @taskless/cli` under npm would work; a team adding the CLI as a devDependency under pnpm would get a silently binary-less prose engine. The same objection would stand if the Vale project published this package itself.

- **Alternative — depend on `@vvago/vale`:** rejected on mechanism per above, and secondarily on putting a third party in the critical path of a load-bearing engine.
- **Alternative — require Vale on `PATH` only:** rejected once Vale is load-bearing; it makes the prose engine work only where someone independently installed it, which is a worse outcome than the publish pipeline it avoids. `PATH` stays as a fallback, not the delivery.
- **Alternative — download at runtime into `node_modules`:** rejected; the canonical invocation is `npx @taskless/cli` (`util/invocation.ts:7`), so the install is ephemeral and the binary would be re-fetched on essentially every run. It is also unsafe generally — pnpm's store is content-addressable and hard-linked, so writing into `node_modules` can corrupt unrelated projects sharing it, and it breaks under read-only installs and in Docker layers.

If a download is ever wanted despite this, the only acceptable form is a **user cache directory** (surviving `npx`, never `node_modules`) with a pinned version and a verified checksum.

**Cost, stated plainly:** roughly seven packages, each a binary plus a `package.json` declaring `os`/`cpu` and containing no code, produced by a CI job that pulls Vale's release assets and republishes them under our scope. The recurring cost is a version bump per upstream Vale release.

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

### D9 — The engine-selection topic ships with the engines it names

Making the CLI multi-engine creates a decision that did not previously exist: **which engine enforces a given rule**. Today that knowledge lives only in the platform's generator, as a binary `static | runtime` classifier prompt that predates Vale; no `help/*.txt` recipe states it. Adding a third engine without also stating the choice would leave every local authoring path assuming ast-grep.

The topic therefore belongs to this change rather than a follow-on. It names `sg`/`vale`/`runtime` — the directories D1 introduces — so shipping it separately would either describe engines that do not yet exist or leave a window where the layout is engine-partitioned and the guidance is not. Task 7.2 already puts help and onboarding text in this change's scope; this is that work carried to its conclusion.

Three constraints shape the text, each from a real failure mode:

- **Engine selection is not authoring destination.** `route` decides `existing`/`static`/`remote` and is a pre-service, local decision. This topic decides only the engine. Locally they compose (route, then engine); the service runs only the second half. A sentence that would only make sense to an agent standing in a user's repo belongs in `route`.
- **Engine selection is not trust tier.** `sg` and `vale` are both static-tier; only `runtime` involves login, reconcile, and signing. Conflating the two axes is precisely what the platform's binary prompt got wrong, and it is why "static vs runtime" cannot simply be renamed.
- **The ambiguity default must name an available engine.** Stated as that property rather than as a bare fact about `sg`. With both binaries shipped as dependencies (D6b), `sg` and `vale` are normally both available locally, and the property is satisfied rather than strained — but it still binds on an unsupported architecture or a blocked install, where the `PATH` fallback may find nothing. On the service the same conclusion follows from a different cause: `sg` is the only ungated route. Writing the rule as a property keeps one sentence correct across all three situations.

Exporting the topic through `@taskless/cli/prompts` is deliberately **not** coupled to this change: the export mechanism is a separate change, and the topic file is useful to the local `help` flow with or without it. Whichever lands second adds the one-line `TOPICS` entry.

- **Alternative — a separate follow-on change for the topic:** rejected; it either ships guidance for engines that do not exist yet, or leaves a release where `check` dispatches three engines while every recipe still assumes ast-grep.

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

**Vale binary packaging** — the per-platform packages (D6b) are their own release-engineering task: which architectures to cover beyond the ast-grep set, and the CI job that mirrors upstream Vale releases. It does not block the engine work; resolution falls back to `PATH` while the packages are being stood up, and the missing-binary path degrades cleanly throughout.

The three revisited items are resolved: Vale rule-tests use per-rule `pass/`/`fail/` subdirectories with a verify-time-**generated** isolating `.vale.ini` (mirroring ast-grep's valid/invalid); Taskless breadcrumbs in `.vale.ini` use the `tskl) <name> = <value>` namespace (all namespaced key syntaxes verified tolerated); and the runtime tier is **realigned** to `runtime/` in this change (content-preserving move).

All hard mechanisms are verified against `vale 3.15.1` / `sg 0.41.0`: native-config scoping, `.vale.ini` enable/disable composition, StyleName requirement, `--config` scale path, ignored `tskl)` keys, Vale sandbox.
