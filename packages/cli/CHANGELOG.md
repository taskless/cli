# @taskless/cli

## 0.11.0

### Minor Changes

- f7ee186: Partition `.taskless/` by rule engine. Migration `0004` moves ast-grep rules to `sg/rules/` and `sg/rule-tests/`, the runtime tree to `runtime/rules/` and `runtime/rule-tests/`, and scaffolds an inert `vale/`. Files move byte-for-byte, so runtime rule signatures survive.

  The directory a rule sits in now **is** its engine: dispatch reads the path and never parses a rule file to decide who owns it. `check` runs ast-grep against the committed `.taskless/sg/sgconfig.yml` instead of generating an ephemeral config each run.

  A rule engine the CLI does not recognize is now rejected with a message instead of failing silently: an unsupported engine from the server previously exited 0 with no output, which read as success.

  Runtime rules are discovered under `runtime/rules/` rather than the pre-migration `runtime-rules/`. Migration `0004` moves that tree byte-for-byte, so the signatures the server validates are unchanged.

  `check` and `rule verify` read the committed `.taskless/sg/sgconfig.yml` rather than writing an ephemeral config on every run, so the config ast-grep uses is the one you can edit and review. A pre-migration rule set still gets a generated config, so an unmigrated project keeps running.

  Existing projects keep working without action. The pre-`0004` `.taskless/rules/` still runs as ast-grep, and a delivered rule that names no engine is still treated as ast-grep — a rule engine this CLI does not recognize is rejected rather than guessed at. A migration that would have to merge a file into an engine directory now refuses up front with `SCAFFOLD_CONFLICT` rather than failing part-way.

- d4fca88: Add a `@taskless/cli/prompts` subpath export exposing the CLI's knowledge prompts as importable, topic-keyed render functions.

  `getPrompt(topic, options?)` and the `PROMPTS` map return fully rendered recipe text, with every `%(KEY)s` placeholder already resolved from values the package holds, so a consumer never handles a template dialect. Topic names are typed as `PromptTopic` and start at `static`, the one recipe a service-side consumer can act on; everything else stays internal until a consumer needs it. `PromptOptions` covers the anonymous variant, a `packageManagerDlx` override, and `header: false` for callers placing the text in an LLM system prompt, where the CLI version in the header would otherwise churn the prompt-cache key on every publish.

  The export is sourced from the same embedded recipes and the same render path `taskless help <topic>` serves, so the two surfaces cannot drift, and it carries no CLI runtime, so a Worker can import it without pulling in the command tree.

- 6b07695: Ship Vale as per-platform binary packages.

  The CLI now declares `@taskless/vale-<os>-<cpu>` as `optionalDependencies` pinned
  to an exact version, so installing it also brings down a verified Vale binary for
  the host platform — no lifecycle script, and nothing to download at runtime. Only
  the matching platform installs; unsupported hosts install cleanly with none
  present and continue to fall back to a `vale` found on `PATH`.

- 0e03ee9: Add Vale as a second static-tier rule engine, give every engine one rule layout, and rename the agent-facing command.

  `check` now dispatches by engine and runs ast-grep, Vale, and runtime rules
  concurrently, merging their findings into one result set. An unavailable Vale
  reports itself and the other engines still return. A Vale that times out or
  rejects its config fails the check rather than passing as a clean run.

  **Every rule is now one directory**, `.taskless/rules/<engine>/<id>/`, holding
  the rule, any per-engine config, and its tests in `.tests/`. Writing a rule
  means creating a directory and deleting one means `rm -rf`. Nothing outside it
  is touched either way, so concurrent authors never collide on a shared file.

  Vale rules carry their own `.vale.ini` declaring which files they apply to.
  The single config Vale reads is assembled from those per-rule files on each
  run, gitignored, and regenerated, so hand edits to it have no effect. ast-grep
  keeps its `files`/`ignores` inside the rule and needs no second file.

  **`rule verify` is replaced by two path-addressed commands.** `verify <path>`
  checks that a rule has the components its engine requires and needs no tests,
  so it works while you're still authoring. `test <path>` runs the rule's tests,
  after running `verify` and stopping if that fails. Both take a rule directory,
  an engine directory, or nothing at all for the whole project, and both report
  one result per rule. Addressing by path rather than id removes the ambiguity
  that arose when two engines held the same rule id.

  Projects on an older layout migrate automatically on the next command.

  **BREAKING: `taskless help <topic>` is now `taskless agent <topic>`.** The
  command is named for who reads it. Agents fetching a procedure are not asking
  for help, and the old name is gone rather than aliased.

  **BREAKING: topics are addressed by a single token.** `taskless help rule
create` becomes `taskless agent create-sg-rule`; multiple positionals are no
  longer joined into a topic key. A topic name is now a literal string an agent
  copies rather than a phrase it can reorder. The renames:

  | Was                | Now                                     |
  | ------------------ | --------------------------------------- |
  | `rule create`      | `create-sg-rule` / `create-remote-rule` |
  | `rule improve`     | `improve-rule`                          |
  | `rule delete`      | `delete-rule`                           |
  | `rule verify`      | `verify-rule`                           |
  | `rule meta`        | `rule-meta`                             |
  | `static`           | `create-sg-rule`                        |
  | `existing`         | `create-legacy-rule`                    |
  | `engine-selection` | `route`                                 |

  `route` now applies the engine reasoning itself and names a concrete
  `create-*-rule` topic, so `engine-selection` is removed rather than renamed —
  its criterion is stated once, in `route`. Every authoring recipe is rewritten
  for the rule-directory layout.

  **BREAKING for `@taskless/cli/prompts` consumers.** `engine-selection` is no
  longer exported. `TOPICS` is now `create-sg-rule`, `create-vale-rule`, and
  `create-runtime-rule`, so a consumer that decides an engine can reach the
  procedure for each destination. Because the export is a string union, a
  consumer passing the removed name dynamically breaks on upgrade rather than at
  build time.

### Patch Changes

- 87abaf3: Fix the pass/fail counts reported when a rule's `ast-grep` tests fail.

  `ast-grep test` echoes the source of a failing test case, and `verify` scraped
  its counts with unanchored regexes over stdout and stderr combined — so a
  fixture containing text like `'7 passed; 0 failed'` was read as the summary and
  `verify` reported `✗ failed (7 passed, 0 failed)` for a run that actually had 0
  passed and 1 failed. The counts are now read from the summary line itself
  (`test result: ok.` / `Error: test failed.`), with ANSI colors stripped first.

  This only affected the reported numbers, never the pass/fail verdict, which
  comes from the exit code — but those numbers are handed to the agent driving
  `improve-rule`, where a wrong count can steer the next edit. Test output is also
  now decoded with a `StringDecoder` per stream, so a multi-byte character split
  across a chunk boundary is no longer mangled.

- 1fb9dda: Rewrite the CLI README around what you actually do with Taskless: installing it,
  driving it from your coding agent with the `taskless` skill and `/tskl` command,
  running `taskless check` in CI, and where to find the docs. Telemetry — and the
  two environment variables that turn it off — is now stated plainly instead of
  being left to the source.
- f13d501: Stop corrupting non-ASCII characters in ast-grep's error output.

  `runAstGrepScan` and the runtime narrow both decoded ast-grep's stderr one
  chunk at a time with `chunk.toString()`. A multi-byte UTF-8 sequence split
  across a chunk boundary was decoded as two invalid sequences, and both halves
  became replacement characters before the pieces were joined — the original
  bytes unrecoverable by then. Each stream now uses a single `StringDecoder`,
  flushed on close, matching what the Vale runner and `verify` already do.

  The corrupted text only ever reached an error message, so no scan result was
  ever wrong. But that message is the one a user reads when ast-grep rejects a
  rule file, naming a rule id or a path — which is exactly where a non-ASCII
  character turns up.

- 87392fa: Make `--help` work on every command, instead of running the command.

  `taskless check --help` printed no usage — it ran `check`. So did every other
  subcommand: `--help` was parsed as an unrecognized flag and the command body
  executed anyway, which meant asking `init` how it works installed skills, and
  asking `check` how it works migrated the `.taskless/` scaffold. The only place
  help worked was the bare `taskless --help`, whose own output tells you to run
  `taskless <command> --help`.

  `--help` and `-h` are now recognized at every depth, including nested commands
  (`taskless auth login --help` describes `login`, not `auth`), and a working
  directory passed before the command (`taskless -d ./repo check --help`) no
  longer confuses which command you asked about. The usage text itself is
  unchanged, and nothing else about how commands run has changed.

- 32da4f9: Stop the engine-partition migration from relocating a rules tree that is already partitioned.

  A `.taskless/` with no `taskless.json` — a manifest that was never committed, or was deleted — reads as version 0, so every migration runs against it. Migration `0004` then applied its `rules/` → `sg/rules/` move to a tree already in the current layout, burying every rule at `.taskless/sg/rules/sg/<id>/`; `0005` scaffolded fresh empty engine directories over the gap. Nothing errored. `check` scanned a tree with no rules in it and exited 0 on a clean report, so a project that had silently stopped being checked was indistinguishable from one that passes.

  `0004` now reads the shape of `.taskless/rules/` before moving it. A tree holding engine directories and no loose rule files is newer than the migration, not older, so it is left alone. A genuinely pre-`0004` tree of flat `rules/<id>.yml` files still moves wholesale, as before. And a tree holding both — an already-partitioned layout with a stray `rules/<id>.yml` beside it, as a merge-conflict leftover produces — migrates only the stray files: moving the directory to collect them would carry the partitioned rules down with it, and `0005` never brings them back, which is the same silent clean pass by another route.

- 0cc713e: Split the release pipeline so each workflow file carries one release design.

  `release.yml` held two jobs with opposite trust properties behind one header.
  It is now `release-cli-changeset.yml` — which reads contributor-authored
  changesets and opens the Version Packages PR holding no npm credential and no
  OIDC identity — and `release-cli.yml`, which keeps the credential-free
  "is this version already on npm?" gate together with the publish job it
  protects, so an OIDC-capable job is never instantiated on an ordinary merge.
  `vale-binaries.yml` is renamed `release-vale.yml` to match.

  The build and publish steps themselves are unchanged — same triggers, same
  `permissions: {}`, same action pins, same OIDC trusted publishing behind the
  same `npm-production` approval. Two operational details do differ: `check` and
  `publish` no longer share the `release-*` concurrency group, and the release
  now runs as two workflow runs instead of one, so its check contexts are
  `Release CLI Version PR / …` and `Release CLI / …` rather than `Release / …`.
  Neither is a required check.

  The header comments also get one correction: they claimed `npm-production` had
  no required reviewers, and it has had one all along, so a release has always
  waited for a human approval that the file said was not there.

  Publish unreleased work on `main` as `@taskless/cli-nightly`.

  Every push to `main` that has changesets pending now publishes the CLI under a
  second package name, stamped `<next-version>-<yyyymmddhhmmss>x<short-sha>` — so
  merged-but-unreleased behavior is installable with `npx @taskless/cli-nightly`.
  A nightly is the same build as the release it anticipates and keeps the
  `taskless` executable, so it is a drop-in; the rename happens at pack time, so
  `@taskless/cli`'s own version history stays releases-only. Installing both
  globally collides on the binary and is unsupported.

  Two credential-free gates decide whether anything is built — pending changesets
  first (before any install), then whether the commit already has a nightly — so
  the publishing job is never instantiated on an ordinary push, and the merge of a
  Version Packages PR publishes the real release and no nightly with no rule
  special-casing it.

  A nightly now ships instructions for itself. The skills, commands, and recipes
  a nightly installs name `npx @taskless/cli-nightly@<version>` — pinned to the
  build being installed — instead of `npx @taskless/cli`. Previously a nightly
  carried the released CLI's text verbatim, so an agent following it ran the
  released binary: no error, just instructions for a different package, on a
  build installed precisely to exercise unreleased behavior. The version is
  stamped once and passed to both the build and the pack, so the version the
  instructions name is always the version on npm, and a nightly build without a
  valid version fails rather than falling back.

  The nightly's duplicate-suppression gate also now fails closed. An unreadable
  registry response used to read as "this commit has no nightly", and since each
  build stamps a fresh timestamp, a re-run after one would have published a
  second nightly for the same commit successfully and silently.

- a7ec7a1: Complete the `help` → `agent` rename. The user-facing command was renamed in
  0.10.0, but the internals kept the old name: the recipe directory moved from
  `packages/cli/src/help/` to `packages/cli/src/agent/`, the `cli-help` OpenSpec
  capability is now `cli-agent`, and the shipped skill and `/tskl` command no
  longer tell agents to run the removed `npx @taskless/cli help <topic>` (they
  now use `agent`, with the single-token topic names — `route`, `improve-rule`,
  `delete-rule`, `create-sg-rule`, and siblings).

  **Telemetry rename (hard cut, no dual-emit).** The `cli_help` event is renamed
  to `cli_agent`. The `topic` property is unchanged. PostHog dashboards keyed on
  `cli_help` will need updating — nothing is emitted under the old name.

- db8adfa: Resolve the ast-grep binary without relying on an install-time step, and drop
  the `@ast-grep/cli` wrapper from what consumers install.
  - **The wrapper moves to `devDependencies`.** The seven `@ast-grep/cli-<platform>`
    packages were already declared in `optionalDependencies`, and the CLI already
    resolved them by path — the wrapper was a leftover whose only job is a
    `postinstall` that hardlinks the binary into itself so its `bin` entries work.
    Nothing here invoked those entries. Consumers now install only the platform
    package matching their host, and the wrapper's `postinstall` — which leaves a
    placeholder text file where the binary should be under `pnpm dlx`'s strict
    isolation — is out of the shipped product entirely. It stays as a
    `devDependency` because `fetch-ast-grep-schema` reads its version.
  - **Platform packages are pinned exactly at `0.41.0`.** They were carets, and the
    wrapper had been enforcing alignment implicitly by pinning its own
    `optionalDependencies`; without it, two hosts could resolve different ast-grep
    versions against the same rules and disagree about findings. Held at `0.41.0`
    rather than taking upstream's `0.45.0`, so this change stays structural.
  - **Binary resolution exhausts every candidate before failing.** It now searches
    the platform package, `node_modules/.bin`, then `sg` and `ast-grep` on `PATH`,
    and throws naming what it tried. Previously it returned a bare `"sg"` and let
    `spawn`'s `ENOENT` be the error, from a caller that could not say where it had
    looked.

  Alpine improves as a side effect: upstream publishes no musl build and marks its
  Linux packages `libc: ["glibc"]`, so today the wrapper's `postinstall` resolves a
  package that does not exist and exits 1, failing the install wherever dependency
  scripts run. Installing now succeeds and resolution falls through to `PATH`.

## 0.10.2

### Patch Changes

- 1cd0f89: Treat the Taskless organization UUID as the one canonical identity, and become
  forward-compatible with the server's coming identity cleanup.
  - **Stop consuming `installationId`.** It is dropped from the `WhoamiOrg` type
    and from the `taskless rule meta --json` output (it was already optional and
    absent for public repos). The CLI never used it and it should not round-trip
    through us.
  - **Namespace the GitHub org id.** `WhoamiOrg.orgId` is now optional and a new
    `githubOrgId?: number` is added, so a consumer reads `githubOrgId ?? orgId`
    and keeps working across the server's rename. It is a convenience id, never an
    identity.
  - **Identify on the canonical id.** `decodeOrgId` validates the token's `id`
    claim (a UUID string) and the legacy `orgId` claim (numeric, or a numeric
    string) independently: a valid `id` wins, an invalid `id` still lets a valid
    `orgId` through, and a non-numeric `orgId` is rejected rather than smuggled in
    as an identity. PostHog then groups organizations on that canonical id. Tokens
    that don't yet carry an `id` claim fall back to the numeric claim, so grouping
    is unchanged until the server starts sending it.
  - **Always have a known org id.** When neither a matched org nor a token claim
    resolves, the canonical id falls back to the nil UUID
    (`00000000-0000-0000-0000-000000000000`) instead of being absent — so the org
    subject and telemetry group are always a stable, known value and unattributed
    usage lands in one bucket. As a result, a write from a token missing org info
    now sends the nil-UUID subject rather than failing with a re-authenticate
    error.
  - **Tolerate `number | string` on the legacy path.** The canonical `id` stays a
    UUID `string`, but `decodeOrgId` accepts either type since we can't promise
    what a legacy claim carries.

## 0.10.1

### Patch Changes

- 53b2d30: Add a help recipe for the `detect` command.

  `detect` is a registered subcommand, so it appeared in the `taskless help`
  topic index — but `taskless help detect` had no backing `detect.txt` and fell
  through to "Unknown command", exiting 1. Every other registered command already
  had a matching help file; `detect` was the lone gap. The new recipe documents
  the `--json` output shape (linters, languages, ruleStyles) and cross-links to
  the `route`/`existing` authoring flow that consumes it.

## 0.10.0

### Minor Changes

- da74920: Send an `x-taskless-cli-version` header on every request to the Taskless service (rule generation, reconcile, `whoami`, and the device-auth flow) declaring the CLI's version. The service uses this to gate capability-dependent responses — notably runtime rules — on the CLI being new enough to handle them; a request without the header is treated as a pre-runtime CLI. The version is also emitted with the CLI's telemetry so usage is recorded client-side rather than inferred server-side.
- 19f4327: Send the acting organization's identity on every write request. The CLI now resolves which Taskless org owns the current repository by matching the repo's git remotes (`origin` → `upstream` → rest) against the canonical owner URLs returned by `whoami`, and sends that org's Taskless UUID as the subject on rule generation, iterate, and reconcile calls. This fixes multi-org users being routed to whichever org their token happened to pin; the server authorizes the chosen org per request. When no remote matches a known org, the CLI falls back to the token's numeric `orgId` claim, so single-org behavior is unchanged.

  The client-side owner-URL canonicalizer is a verbatim port of the server's shared implementation, so both sides compare by exact string equality across SSH, `ssh://`/`git://`, port, and `www.` remote forms.

  `rule create`/`rule improve` now handle two additional generation states: `classifying` (a transient pre-build phase) and `unsupported`, a terminal state emitted when the request needs a capability the organization's plan doesn't include (for example, runtime rules) — surfaced with a clear message and the new `RULE_UNSUPPORTED` error code. When the server can't act on a repository for the selected org (its GitHub App installation doesn't cover the repo, or membership changed), the CLI now explains the coverage cause rather than only suggesting re-authentication.

- f392880: Add server-owned rule reconciliation and runtime rules to `taskless check`. Authenticated runs reconcile the repo's rules against the Taskless service and execute only the server-blessed set. A new class of **runtime rules** (`.taskless/runtime-rules/` — one or more ast-grep capture rules plus a `check.ts` assertion) runs through a local harness: the capture rules narrow with ast-grep, and only on a match is `check.ts` invoked via a bundled `tsx`. Because `check.ts` is arbitrary code, it runs only when its signature is validated by the server; otherwise it is skipped and reported. Adds the `--dangerously-run-scripts` (run runtime rules unverified) and `--timeout` flags.

  (Backfills the changeset that was missed when this work landed across #47, #49, and #50.)

## 0.9.0

### Minor Changes

- 9be2000: Require Node.js 22+ and make `taskless detect` monorepo-aware.
  - **Node floor raised to 22+.** Node 20 reached end-of-life, and detect now uses
    the built-in `fs.glob` walker (Node 22+). This is a breaking engine change,
    which pre-1.0 is a minor bump.
  - **`detect` is monorepo-aware.** A single bounded tree walk (curated ignore
    list + depth cap) finds linter configs and language manifests anywhere in the
    repo, not just the root, so a linter configured in a sub-package is detected
    with its path as evidence.
  - **languages → linters flow.** A linter's dependency evidence is read only from
    its own language's manifest (`package.json` for node, `pyproject.toml` /
    `requirements.txt` for Python), parsed with real parsers (`smol-toml`,
    `yaml`), instead of conflating ecosystems. A malformed manifest drops only its
    own signal.
  - **Dropped the `frameworks` field** from `detect` output. The routing recipe
    never consumed it; the contract now matches its sole consumer.
  - **Filled obvious linter gaps** for languages detect already recognizes:
    golangci-lint (Go), Clippy (Rust), and PHPStan / PHP_CodeSniffer / Psalm
    (PHP).

- 7a29587: Add a local-first rule-routing layer. A new deterministic `taskless detect`
  command plus `route`/`existing`/`static`/`remote` recipes let the agent author
  rules in an existing linter or as a local ast-grep rule on-device, only
  escalating to the login-gated service (with confirmation) when a rule cannot be
  built locally. The skill now engages this routing flow when a user names a
  linter instead of suppressing itself.

### Patch Changes

- a668855: Drop the unused `installedAt` timestamp from the install manifest.

  The timestamp was written into `.taskless/taskless.json` on every install but
  never read, so it only produced spurious diffs in committed manifests (e.g.
  after `pnpm build:self`). A new schema migration (v3) strips it from existing
  manifests, and install output is now deterministic. No user-facing behavior
  changes.

## 0.8.1

### Patch Changes

- b2fd824: Stop stamping a version into reference stubs to keep the footprint outside `.taskless/` stable across releases.
  - **Version-free stubs**: `buildSkillStub` / `buildCommandStub` no longer write `metadata.version` into the reference stubs installed into tool directories. Previously every release that bumped the bundled version counted as drift, so `update` rewrote every stub even when its `name`/`description` were unchanged — pure churn in projects that consume Taskless.
  - **Drift is name/description only, going forward**: `stubFrontmatterDrifted` regenerates a stub when its discoverable `name`/`description` changes — not on every version bump. The canonical version still lives in `.taskless/` (the skill `SKILL.md` frontmatter), which is where staleness checks already read it from.
  - **One-time migration**: `stubFrontmatterDrifted` also treats the presence of a `metadata.version` field as drift, so the next `init` / `update` rewrites each already-installed stub once to strip the obsolete line. After that pass the stub footprint is byte-stable across releases and only changes when the shim's `name`/`description` does.
  - **Command shim cleanup**: removed the stale `metadata.version` from the `/tskl` command source. It had been pinned at `0.6.0` while its body last changed in `0.7.0`; the field was only ever consumed to stamp stubs, so it is now dead.

  No functional change between 0.8.0 and this release — stub frontmatter was never a documented public API. Expect a single one-time rewrite of existing stubs (to drop the version line); thereafter installs and `update` runs no longer report or rewrite stubs purely because of a version bump.

- 48506ff: Make the wizard's tool-selection step manifest-aware so unchecking a location removes Taskless from it.
  - **Manifest-driven pre-check**: the `taskless init` tool-selection multiselect now pre-checks the union of directories recorded in the install manifest and detected tool directories — previously it pre-checked detected tools only. A location Taskless already installed into (notably `.agents/`, which has no detection signal of its own) now shows checked, so it can be unchecked to remove the stubs. The install engine already performed manifest-diffed, target-scoped removal; this only surfaces it in the UI.
  - **Three-state hint**: each entry is hinted by origin — `installed` (recorded in the manifest, takes precedence), `detected` (tool present), or `not detected`.
  - **Itemized removal confirmation**: when unchecking a location triggers removals, the confirm prompt now names each target and its stub count (e.g. `Remove Taskless from .claude/ (2 stubs)?`) instead of a generic message.

  The non-interactive `init --no-interactive` / `update` paths are unchanged, and the canonical `.taskless/` store is never removed.

## 0.8.0

### Minor Changes

- d254b67: Install a single canonical skill/command store with thin per-tool reference stubs.
  - **Canonical store**: `taskless init`/`update` now writes the skill and command content exactly once, to `.taskless/skills/<name>/SKILL.md` and `.taskless/commands/tskl/<name>.md`. This Taskless-owned directory is never a tool install target, so no install or cleanup step can ever delete it.
  - **Reference stubs**: each enabled tool directory (`.claude/`, `.cursor/`, `.opencode/`, `.agents/`) receives a thin reference stub instead of a full copy — an ordinary file (never a symlink) carrying `name`/`description` frontmatter, a `metadata.type: shim` marker, and a body that delegates to the canonical file. This ends the N-identical-copies drift of the previous per-tool full-copy model. `.claude/` and `.cursor/` also receive a `tskl` command stub; `.opencode/` and `.agents/` receive skills only.
  - **Per-target install mode**: `.taskless/taskless.json` records a `mode` (`canonical` | `reference`) per target. The field is additive and backward-compatible — a manifest written before this change reads its entries as `canonical`, so no schema migration is needed.
  - **Self-healing convergence**: `applyInstallPlan` rewrites a reference file unless it is already a current, non-drifted shim stub. Full per-tool copies left by older installs, manually-created symlinks, and stubs whose frontmatter has drifted are all converged into stubs on the next `init`/`update`. The destructive `rm -rf` glob cleanup is removed; cleanup is now driven solely by the recorded-manifest diff and scoped to each target's own directory.
  - **Wizard tool selection**: the wizard's location step is reframed as "which tools do you want to enable Taskless for?" — a fixed multiselect of `.claude/`, `.cursor/`, `.opencode/`, `.agents/`, with detected entries pre-checked and `.agents/` the default when nothing is detected. The canonical `.taskless/` store is always written and is not a selectable entry.
  - **No symlinks**: the CLI never creates symlinks for skills or commands. Symlink-based skill discovery is unreliable across Cursor, OpenCode, and Codex, and breaks on Windows checkout.

- f6fbaba: Add `taskless onboard` post-install discovery flow and migrate recipe rendering to sprintf-js.
  - **`taskless onboard` subcommand**: a thin gate that prints an agent-facing recipe walking the host AI tool through mining the codebase, agent-memory files (CLAUDE.md / AGENTS.md / .cursorrules), recent PR review comments (via `gh`), and issue-tracker tickets (via MCP) for high-signal rule candidates. Output is a bullet list the user can materialize via `taskless rule create`. Three modes: default prints the recipe (refused if already complete), `--force` re-runs regardless of state, `--mark-complete` writes `install.onboarded: true` (invoked only by the agent after explicit user confirmation). `--force` and `--mark-complete` are mutually exclusive.
  - **`install.onboarded` manifest field**: optional 3-state boolean (absent / `false` / `true`) added to `.taskless/taskless.json`. `taskless init` never writes it; only `taskless onboard --mark-complete` does. Re-installs preserve the existing value.
  - **Post-install onboarding trailer**: after a successful `taskless init` (both wizard and `--no-interactive` paths), the CLI prints a one-line trailer pointing the user at the new flow. Wording adapts to the install plan: when commands were installed (Claude Code, Cursor), the trailer mentions `/tskl onboard`, the Taskless skill, and `taskless onboard`; when no commands were installed (OpenCode, Codex, `.agents/` fallback), it mentions the skill and the CLI only. `taskless update` does not print the trailer.
  - **Skill description trigger expanded**: the consolidated `taskless` skill now also volunteers Taskless when the user asks to add/write/create a rule and has NOT named a specific lint/format/static-analysis tool. Suppressing examples (illustrative — any named tool of this kind suppresses): `eslint`, `ruff`, `biome`, `ast-grep`. Behavior on this trigger is a quiet single-line offer, not a full recipe; declines are sticky within the conversation only and never written to disk. Replaces the prior blanket "do NOT trigger on generic ESLint/linting" carve-out.
  - **Recipe substitution refactor**: recipe rendering switched from ad-hoc `{{KEY}}` `replaceAll` calls to `sprintf-js` named arguments. All recipes now use `%(KEY)s` placeholders. `CLI_VERSION` and `INPUT_SCHEMA` continue to resolve to system-rendered values; `PACKAGE_MANAGER_DLX` joins them as an "agent-fill" marker rendered as `<package-manager-dlx>`. Recipes that contain literal `%` characters must escape as `%%` per sprintf-js conventions.

## 0.7.0

### Minor Changes

- 33010d4: Add Codex support and expand Cursor with slash commands.
  - **Codex detection**: `taskless init` now detects OpenAI Codex via `.codex/` directory or `.codex/config.toml` and labels the install as Codex in the summary. Skills are written to `.agents/skills/<name>/SKILL.md` — Codex's documented read path, which happens to match our existing fallback location, so users with `.codex/` previously fell into the generic fallback path silently. Codex receives no command files: custom slash commands are deprecated upstream and skills are the official replacement.
  - **Cursor commands**: the Cursor descriptor now ships our `tskl` slash commands to `.cursor/commands/tskl/<name>.md`, mirroring what Claude Code receives. Cursor 1.6 added commands as a real authored surface; previously Cursor users only got skills.
  - **Wizard label**: detected-tool hints in the install location prompt now name the tool (e.g. `detected (Codex)`) instead of just "detected".

- f11cb5f: Consolidate the 10 per-task Taskless skills into one. The `taskless` skill is now a small router whose body tells the agent to fetch the canonical recipe via `npx @taskless/cli help <topic>` rather than carrying full per-task instructions inline. Recipes live in the CLI bundle so the agent always reads the version current to the installed CLI. This addresses customer reports of the Taskless plugin causing other skills to be evicted from the working set.

  **Breaking changes:**
  - **Skill names removed.** `taskless-check`, `taskless-ci`, `taskless-create-rule`, `taskless-create-rule-anonymous`, `taskless-delete-rule`, `taskless-improve-rule`, `taskless-improve-rule-anonymous`, `taskless-info`, `taskless-login`, `taskless-logout` no longer exist. The single `taskless` skill replaces them. Existing v0.6 installs auto-migrate when the user runs `npx @taskless/cli` (the install plumbing reads the manifest, deletes obsolete files, writes the consolidated skill).
  - **Slash commands collapsed.** The 6 commands under `commands/tskl/` are replaced by a single `/tskl` router that accepts a free-form `$ARGUMENTS` ask.
  - **CLI verb renamed: `rules` → `rule` (singular).** `taskless rule create`, `taskless rule improve`, `taskless rule delete`, `taskless rule verify`, `taskless rule meta`. The plural form is no longer recognized — there is no compatibility alias. Pipelines and scripts must update.
  - **`--schema` flag removed.** Schemas are now embedded inline in `taskless help <topic>` output via `z.toJSONSchema()` (zod 4 built-in). Agents that previously parsed `--schema` output should fetch the relevant `help` topic and read the embedded code-fenced JSON Schema block.
  - **Telemetry rename (hard cut, no dual-emit).** `cli_help_*` events are renamed to `help_<topic>` (intent), `help_index` (no-args fetch), and `help_unknown` (unrecognized topic). Action commands now emit `cli_<action>` (start) and `cli_<action>_completed` (with `success`, `durationMs`, `errorCode?` properties). PostHog dashboards keyed on the old names will need updates.

  **New features:**
  - **Global `--anonymous` flag.** Recognized on every command. Per-command behavior: `info` skips the API/auth probe; `auth login` errors with "auth commands cannot be anonymous"; `rule create`/`rule improve` exit with a pointer to `taskless help <topic> --anonymous` (the local-only flow runs in the agent per the architecture decision in the OpenSpec change).
  - **`taskless help <topic> --anonymous`.** Variant lookup serves `<topic>.anonymous.txt` when present and falls back to the canonical recipe otherwise. Build-time map keeps lookup O(1).
  - **Standardized JSON error envelope.** When `--json` is set, failures emit `{ ok: false, code: "<CODE>", message: "<...>" }` with stable codes (`AUTH_REQUIRED`, `NO_GITHUB_REMOTE`, `RULE_GENERATION_FAILED`, `RULE_NOT_FOUND`, `INVALID_INPUT`, `NETWORK_ERROR`, `SCAN_FAILED`, `INTERNAL_ERROR`). Recipes reference these codes by name in their `## Errors` sections.
  - **Recipe template.** Every help text follows the same shape: Goal / Preconditions / Steps / Input schema (where applicable) / Errors / See Also. Header line includes the CLI version and a topic version. `{{INPUT_SCHEMA}}` and `{{CLI_VERSION}}` placeholders are interpolated at runtime.
  - **Bare `taskless` non-TTY routing.** Without a TTY, bare `taskless` now prints a short context preamble followed by the topic index (instead of citty's default usage screen). TTY behavior unchanged — still launches the wizard.

  **Migration:**

  Run `npx @taskless/cli` after upgrading. The wizard reads your existing manifest, computes the diff (10 obsolete skills + 6 obsolete commands removed, 1 new skill + 1 new command added), confirms with you, then applies.

## 0.6.0

### Minor Changes

- 64f2c4f: Add interactive `init` wizard. Running `taskless` in a terminal (or `taskless init`) now launches a `@clack/prompts` wizard that lets you pick install locations, choose optional skills (currently `taskless-ci`), and walks through the auth tradeoff before writing anything.

  **Breaking:** bare `taskless` (no subcommand) now delegates to `init` when stdout is a TTY. Non-TTY invocations still print top-level help. For scripted installs, pass `--no-interactive` to `taskless init` to preserve the previous behavior (install mandatory skills to every detected tool location, no prompts).

  Also adds:
  - `install` field in `.taskless/taskless.json` (migration 2) tracking per-target skills and commands, used by the wizard to compute a diff and surgically remove files on re-run
  - `taskless-ci` skill in the bundle as an optional opt-in, with agent-facing instructions that cover CI discovery, full-scan/diff-scan patterns, and non-destructive config generation for any CI system the agent recognizes
  - `taskless check <paths...>` for diff-only scanning in CI (silently filters missing paths so `git diff` output can be piped in directly)
  - `cliVersion` and `scaffoldVersion` attached to every PostHog telemetry event, for deprecation tracking

## 0.5.4

### Patch Changes

- 60f8dba: Show auth status when running `taskless auth` without a subcommand, with a hint to run `auth login` if not authenticated.

## 0.5.3

### Patch Changes

- cf813da: Add multi-tool detection for `taskless init`. The CLI now detects and installs skills for OpenCode (`.opencode/`, `opencode.jsonc`, `opencode.json`), Cursor (`.cursor/`, `.cursorrules`), and Claude Code (now also via `CLAUDE.md`). When no tools are detected, skills are installed to `.agents/skills/` as a fallback.

## 0.5.2

### Patch Changes

- 64b836f: Add explicit `commandName: "-"` to anonymous skill frontmatter

  The anonymous skills (`taskless-create-rule-anonymous` and `taskless-improve-rule-anonymous`) were missing the `metadata.commandName` field. Added `commandName: "-"` for consistency with all other skills that don't expose a slash command.

- a4c78fb: Fix "auth login" to use the correct CLI command

  Replaced bare `taskless auth login` references with the proper `npx @taskless/cli@latest auth login` invocation in skills, generated commands, CLI error messages, and rules help text. CLI error messages now dynamically detect the invoking package manager via `npm_config_user_agent`. Skills default to `npx` with a note to prefer the project's package manager.

- 321d285: Fix crash during init when `.taskless/taskless.json` contains corrupt or unparseable JSON. The CLI now treats a corrupt manifest the same as a missing one, allowing migrations to re-run and rewrite it.

  Add `module` and `exports` fields to package.json to ensure ESM resolution works correctly on older Node versions or when package.json resolution is incomplete.

## 0.5.1

### Patch Changes

- 57ccac7: Add anonymous telemetry via PostHog to track CLI command usage

## 0.5.0

### Minor Changes

- 75f3b80: Remove global XDG auth token storage (`~/.config/taskless/auth.json`) in favor of per-repo tokens only. Authentication is now scoped to each repository via `.taskless/.env.local.json`. A deprecation notice is shown when a legacy global token file is detected. The device flow now sends a repository URL hint to the auth server.
- 75f3b80: Reorganize CLI internals into domain directories (`auth/`, `api/`, `rules/`, `filesystem/`, `install/`, `util/`), add a migration-based `.taskless/` bootstrap system, and upgrade from Zod 3 to Zod 4. The filesystem layer introduces numbered migrations with idempotent re-runs, version tracking in `taskless.json`, and automatic v0-to-v1 migration for existing installations. Zod 4 enables native `z.fromJSONSchema()` and `z.toJSONSchema()`, replacing the `zod-to-json-schema` dependency.

### Patch Changes

- 75f3b80: Add anonymous rule creation and improvement skills that work without API authentication. The existing `/tskl:rule` and `/tskl:improve` commands now check auth status via `taskless info --json` and transparently delegate to anonymous variants when not logged in. Anonymous skills use the `rules verify` feedback loop to iteratively validate agent-generated rules against the ast-grep schema.
- 75f3b80: Add `rules verify` command with three-layer validation: Layer 1 validates rule YAML against the official ast-grep JSON schema (fetched at build time via codegen), Layer 2 checks Taskless-specific requirements (required fields, regex-requires-kind, test file existence), and Layer 3 runs `sg test` for the specified rule. Includes `--schema --json` mode that outputs the ast-grep schema, Taskless requirements, and curated examples for agent consumption.
- 75f3b80: Harden CLI security: remove `shell: true` from `spawn` calls to eliminate shell injection surface, add rule ID validation (`/^[a-z0-9][a-z0-9-]*$/`) to prevent path traversal in file operations, escape regex metacharacters in `sg test --filter` arguments, and replace fragile string-based error parsing with structured return types.

## 0.4.0

### Minor Changes

- Remove scaffold dependency from CLI. Identity is now resolved from JWT (`orgId`) and git remote (`repositoryUrl`) instead of `taskless.json`. Add per-repo token storage in `.taskless/.env.local.json`, ephemeral `sgconfig.yml` generation for check command, and fetch OpenAPI schema from live URL.

### Patch Changes

- 48991e6: Fix CLI auth to check token expiry instead of just token existence, preventing commands from reporting a logged-in state with an expired JWT
- 7397516: Write sidecar metadata files from generator API response to `.taskless/rule-metadata/`, fixing metadata not being persisted during rule create and improve flows
- 7397516: Add `rules meta` CLI subcommand to read sidecar metadata for a rule. Update create-rule skill to check for similar existing rules before creating, and improve-rule skill to use `ticketId` from metadata for the iterate API. Fix test directory references and skill-to-skill handoff in both skills.

## 0.3.0

### Minor Changes

- 771a13b: Add `--schema` flag to CLI commands with `--json` support. When passed, prints Input Schema, Output Schema, and Error Schema as JSON Schema objects and exits. Introduces Zod as the single source of truth for CLI I/O validation and schema generation.

## 0.2.1

### Patch Changes

- 230091e: Fix `init` to clean up stale skills and commands from previous naming conventions before installing. Removes all `taskless-*` and `use-taskless-*` skill directories and both `taskless/` and `tskl/` command directories, then installs a fresh set. Also fixes the embedded command glob and tool registry to use the current `tskl` path.

## 0.2.0

### Minor Changes

- ecf338d: Add `rules improve` CLI subcommand and `taskless-improve-rule` skill for iterating on existing rules via the new `/cli/api/rule/{ruleId}/iterate` endpoint. The skill guides agents through a decision tree: iterate on a single rule, replace it entirely, or expand into multiple rules. Also updates `rules create` to accept `successCases`/`failureCases` as arrays (matching the updated API schema).
- ecf338d: Rename skills from `use-taskless-*` to `taskless-*` and commands from `taskless:*` to `tskl:*`. Skill directories now follow the `taskless-<verb>-<noun>` convention (e.g., `taskless-create-rule`, `taskless-improve-rule`). Cross-references in skill instructions now use skill names instead of command names for compatibility with non-command agentic systems.
- ecf338d: Replace hand-written fetch calls with a typed API client powered by `openapi-fetch` and `openapi-typescript`. Request and response types are now generated from the OpenAPI schema at `.generated/schema.json`, removing manual type definitions for API interactions. Rule file types (`GeneratedRule`, etc.) are now derived from the schema.

## 0.1.5

### Patch Changes

- 87d5644: Fixes command in info skill

## 0.1.4

### Patch Changes

- f9d7ac6: Updates skills to collect additional information

## 0.1.3

### Patch Changes

- 914dc37: Fix ast-grep binary not found when CLI installed via pnpm dlx. The strict dependency isolation prevents @ast-grep/cli's postinstall from resolving platform-specific binary packages, leaving a placeholder text file instead of the real binary. Now resolves the platform binary directly from our own module context.

## 0.1.2

### Patch Changes

- fe18d42: Fix `rules create` requiring scaffold version 2026-03-03 which doesn't exist yet, causing users on the latest scaffold (2026-03-02) to be told to update when they're already current

## 0.1.1

### Patch Changes

- 5e0864a: Use default API URL for rule and update-engine providers instead of requiring env var

## 0.1.0

### Minor Changes

- 00320f6: Replace stdin JSON input with --from file flag for rules create

### Patch Changes

- 00320f6: Add update-engine command for requesting scaffold upgrades
- 00320f6: Replace version compatibility ranges with per-subcommand minimum scaffold versions

## 0.0.7

### Patch Changes

- 1f96316: chore: Modernize build tooling and version syncing
  - Replaced link-skills.sh with TypeScript for consistency across all build scripts
  - Refactored package.json scripts to use npm-run-all2 (run-s) for cross-platform sequential execution, removing all && chains
  - Simplified turbo.json by removing root tasks in favor of explicit run-s orchestration via namespaced sub-scripts (build:_, bump:_)
  - Fixed link-skills to also symlink commands/ into .claude/commands/ (was a broken symlink)
  - Version syncing (bump:sync) now also updates .claude-plugin/plugin.json and root package.json to stay in sync with CLI version
  - Disabled unicorn/no-null eslint rule globally, removing inline overrides

## 0.0.6

### Patch Changes

- 872d378: Add `taskless help <command>` subcommand with rich help text for all commands. Help files are plain .txt embedded at build time via import.meta.glob. Supports nested commands (e.g., `taskless help auth login`).
- 382ddfa: Fix YAML frontmatter line wrapping that broke skill installation. The `yaml` library's default 80-character line width was folding long strings (like `description`) across multiple lines, which broke frontmatter parsers expecting single-line values. Disabled line wrapping with `lineWidth: 0` for all YAML serialization (frontmatter, rule files, and test files).
- 9734356: Restructure skills distribution and CLI commands. Move skills from plugins/ to skills/ at repo root. Add multi-channel distribution (CLI init, Claude Code Plugin Marketplace, Vercel skills CLI). Add generate-commands and sync-skill-versions scripts. Restructure CLI with auth and rules subcommand groups, check command with JSON output, and init with org/repo config.
- cd4a671: Skills now invoke `taskless help <command>` as their first step instead of hardcoding CLI documentation. Commands with JSON support (check, rules create) use --json flag. Add link-skills to build graph.

## 0.0.4

### Patch Changes

- Add `taskless rules create` and `taskless rules delete` commands for generating and managing ast-grep rules via the taskless.io API. Includes whoami integration for `taskless info`, a new minimum spec version (2026-03-03) requiring `orgId` and `repositoryUrl` in project config, and executable permissions on the built CLI output.

## 0.0.3

### Patch Changes

- Add check command with ast-grep scanning, version compatibility, and formatting support
- 82ad614: Add init/update command with skill installation and staleness detection

## 0.0.2

### Patch Changes

- Add `taskless info` subcommand that outputs CLI version as JSON. Replace stub entry point with citty-based subcommand structure. Version is injected at build time via Vite define.
