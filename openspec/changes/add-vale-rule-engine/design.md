## Context

`partition-rules-by-engine` established the layout this change executes: `.taskless/<engine>/{config, rules/, rule-tests/}`, dispatch by directory rather than by parsing files, each engine's committed native config as the source of truth, and a scaffolded but inert `vale/`. Read that change's design for the layout, migration `0004`, ingest defaulting, and legacy-path tolerance — none of it is restated here.

What remains is the engine itself. The design was derived empirically against `vale 3.15.1` and `sg 0.41.0`; the facts that shaped it:

- **Vale `.vale.ini` scoping composes cleanly and predictably** (all verified): `[<glob>] Style.Rule = YES` enables a rule for a path (no `BasedOnStyles` needed); overlapping enables **union**; `[<glob>] Style.Rule = NO` **disables** and wins over an enable, order-independent; globs support brace alternation with slashes (`[{marketing/**,docs/**}]`) and whole-section negation (`[!x]`). So arbitrary per-rule include/exclude lives in the `.ini` itself.
- **Vale requires a StyleName directory level** (`StylesPath/<Style>/<rule>.yml`) — a flat rule errors `E100 style does not exist`; a `rules/` dir _is_ that StyleName.
- **Vale accepts and silently ignores unknown ini keys**, so Taskless breadcrumbs ride inside the matcher that owns them rather than in a sidecar.
- **Vale's Tengo `script` sandbox exposes only `text`/`math`/`fmt`** (`os`/`io`/`exec` → "module not found"), so a Vale rule cannot reach the host — trust equals ast-grep static.

## Goals / Non-Goals

**Goals:** run Vale as a second static-tier engine over its committed config; map its findings into the shared `CheckResult`; verify Vale rules from fixtures; run all engines concurrently and merge; state which engine can enforce a given rule.

**Non-Goals:** the engine-partitioned layout, migration, ingest defaulting, and legacy tolerance — all delivered by `partition-rules-by-engine`. Also excluded: generating Vale rules and authoring the committed `.vale.ini`, and restricting Vale's feature set.

## Decisions

### D1 — Scoping is native per engine

- **ast-grep** — a rule's `files` (include) / `ignores` (exclude), verified to path-scope an inline/config rule.
- **Vale** — each `.vale.ini` **matcher** (a `[<glob>]` section) scopes by path and lists which rules run there: include = `rules.<name> = YES` (enables union across matchers), exclude = `rules.<name> = NO` (disable wins). Deterministic and order-independent (verified), so generation is a straight emit of YES/NO matchers — no cascade to reason about.

**Repeat matchers are allowed and merge** — Vale unions duplicate `[<glob>]` headers (verified: `[*.md]` twice fired both rules). Because one rule's scoping can therefore be scattered across several matchers, each Taskless-owned matcher carries a `tskl) rule = <id>` breadcrumb naming its owning rule — a **canonical id** so tooling can find and update the right rule's matchers later rather than guessing from globs.

### D2 — Vale layout maps to StylesPath via the `rules/` StyleName

`.vale.ini` lives at `.taskless/vale/.vale.ini` with `StylesPath = .`, so `.taskless/vale/rules/` is the required StyleName directory (`BasedOnStyles = rules`). Styles are pure-native Vale files; the `rules.` check-name prefix is stripped for `ruleId`. (Flat rules without the StyleName level fail — verified.)

### D3 — Check and verify are pure execution over committed configs

`check` runs each engine's tool with its committed config over the resolved paths, concurrently, and merges `CheckResult`s — **no materialization, no sidecar reads, no config generation, nothing to cache**:

- ast-grep — `sg scan --config .taskless/sg/sgconfig.yml <paths> --json=stream`.
- Vale — `vale --config .taskless/vale/.vale.ini <paths> --output=JSON --no-exit`.

`verify` likewise runs native runners: `sg test -c .taskless/sg/sgconfig.yml` (ast-grep's native tests, matched by rule `id`), and a Vale **fixture runner** over `.taskless/vale/rule-tests/<rule>/` — a per-rule subdirectory of `pass/` and `fail/` fixture documents. Because verify is one-time (not per-check), the isolating `.vale.ini` (StylesPath + only that rule enabled) is **generated** at verify time rather than committed; conceptually this mirrors ast-grep's `valid`/`invalid` (pass/fail), asserting every `fail/` fixture yields a finding and every `pass/` fixture none. Because `generateSgConfig` no longer runs on the check path, `check` calls `ensureTasklessDirectory` directly to preserve the migration trigger.

### D4 — Vale runs in the static tier, unmodified, bounded by a subprocess timeout

Vale's Tengo `script` sandbox exposes only `text`/`math`/`fmt` (verified: `os`/`io`/`exec` → "module not found"), so a Vale rule can't reach the host — trust equals ast-grep static. Vale is always-run, anonymous-safe, no reconcile/signing; a subprocess timeout bounds a runaway Tengo loop. Vale is used as-is.

### D5 — The CLI resolves the Vale binary itself; delivery belongs to another change

Two separable concerns. **Resolution** — where the CLI looks — is settled here. **Delivery** — how the binary arrives — is `add-vale-binary-packages`, a prerequisite of this change.

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

### D6 — Metadata surfaces through `CheckResult`; identity from the rule name

`CheckResult { source, ruleId, severity, message, note, file, range, matchedText, fix }` is the contract each engine maps into. `ruleId` is the rule's basename (ast-grep native `id`; Vale's `rules.<name>` stripped to `<name>`). Severity is engine-native, normalized on the client — Vale `error/warning/suggestion → error/warning/hint` (`info` unused; `.vale.ini` sets `MinAlertLevel = suggestion`). Vale mapping: `message←Message`, `note←Description/Link`, `range←Line+Span`, `matchedText←Match`, `fix←Action` when populated. Provenance is a generation-time server wrapper, never on disk.

### D7 — The engine-selection topic ships with the engines it names

Making the CLI multi-engine creates a decision that did not previously exist: **which engine enforces a given rule**. Today that knowledge lives only in the platform's generator, as a binary `static | runtime` classifier prompt that predates Vale; no `help/*.txt` recipe states it. Adding a third engine without also stating the choice would leave every local authoring path assuming ast-grep.

The topic belongs with the engine rather than with the layout. It names `sg`/`vale`/`runtime` as things an agent can actually choose between, which is only true once Vale executes — shipping it alongside `partition-rules-by-engine` would have described an engine that existed as an empty directory.

Three constraints shape the text, each from a real failure mode:

- **Engine selection is not authoring destination.** `route` decides `existing`/`static`/`remote` and is a pre-service, local decision. This topic decides only the engine. Locally they compose (route, then engine); the service runs only the second half. A sentence that would only make sense to an agent standing in a user's repo belongs in `route`.
- **Engine selection is not trust tier.** `sg` and `vale` are both static-tier; only `runtime` involves login, reconcile, and signing. Conflating the two axes is precisely what the platform's binary prompt got wrong, and it is why "static vs runtime" cannot simply be renamed.
- **The ambiguity default must name an available engine.** Stated as that property rather than as a bare fact about `sg`. With both binaries shipped as dependencies (D6b), `sg` and `vale` are normally both available locally, and the property is satisfied rather than strained — but it still binds on an unsupported architecture or a blocked install, where the `PATH` fallback may find nothing. On the service the same conclusion follows from a different cause: `sg` is the only ungated route. Writing the rule as a property keeps one sentence correct across all three situations.

Exporting the topic through `@taskless/cli/prompts` is deliberately **not** coupled to this change: the export mechanism is a separate change, and the topic file is useful to the local `help` flow with or without it. Whichever lands second adds the one-line `TOPICS` entry.

- **Alternative — a separate follow-on change for the topic:** rejected; it would leave a release where `check` dispatches three engines while every recipe still assumes ast-grep, and the topic is knowledge about the engine rather than a deliverable of its own.

## Risks / Trade-offs

- **Landing before its prerequisites** → this change executes `.taskless/vale/`, which `partition-rules-by-engine` creates, and resolves a binary that `add-vale-binary-packages` publishes. Task group 0 checks both before any implementation starts.

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
