## Context

See proposal.md for the motivation. The pieces this builds on already exist:

- `install.launchers` and `install.cliVersion` in `taskless.json`, and `recordedLauncherVersion()` in `install/launcher.ts`, which answers "what version does this package's launcher run". The gate asks the same question rather than defining a second notion of "the recorded version".
- `buildLauncherPackage()`, which names the package this build belongs to and returns `undefined` for a `self` build.
- `rules.engines`, written by `update --rules` (`recordReconciliation`) and nowhere else, so it is an honest record of what the rules were last reconciled against.
- `requireCurrentSchema()`, the scaffold-layout gate `check` and `verify` already call and already render as a JSON envelope or prose.
- `--allow-version-mismatches`, currently honoured only by the scaffold gate.

## Goals / Non-Goals

**Goals:**

- The CLI that runs a project's rules is the CLI the project recorded, and the rules were reconciled against that CLI's engines.
- Each refusal names a remedy that works from where the reader stands.

**Non-Goals:**

- Running migrations from `check`. `check` never writes to the rules tree (see `cli-check`), and the ledger walk can carry judgment a migration cannot.
- Protecting CLIs already published. They do not contain the gate. The engine gate's "ahead" branch exists for CLIs released after this one.
- Gating `validate`. It checks rule shape against this CLI's schema and is what an agent runs while mid-walk.

## Decisions

### The pin gate runs once, in the entry point, before dispatch

It goes in `index.ts` after the `--help`/`--version` intercepts and before `runCommand`, keyed on the first positional (`splitRawArguments`). One place means no subcommand can forget it, and the exemption list is visible in one spot. The alternative, a call in each command's `run`, is how `requireCurrentSchema` ended up with two call sites carrying different dead fallbacks.

Exempt: no subcommand, `init`, `info`, `auth`, `feedback`. `update` is NOT exempt even though it writes the manifest: it moves `rules.reconciledTo` and `rules.engines`, not the pin, so `npx @taskless/cli@latest update --rules` is exactly the call this exists to stop.

### "Recorded" means the version this package's launcher runs

`recordedLauncherVersion(buildLauncherPackage(), install.launchers, install.cliVersion)`. A release CLI compares against the release launcher, a nightly against the nightly one, so a project carrying both does not refuse either. When that returns `undefined` but the manifest records some version, the project is pinned to the other channel and the CLI refuses: this is the "any mismatch" choice, applied to channels too.

Not gated: no manifest, an unreadable manifest (the command it reaches reports `SCAFFOLD_MANIFEST_UNREADABLE` itself, with the right remedy), a manifest with no version, a `self` build, and a build whose version is `unknown`.

### The remedy depends on direction

Newer than recorded: run the launcher (`./.taskless/bin/cli.mjs`), or `init` with this CLI to move the project to it. Older than recorded: run the launcher. Suggesting `init` there would invite a downgrade. The launcher is named only when its file exists, since projects installed before launchers have none.

### The engine gate is a helper `check` and `verify` call next to `requireCurrentSchema`

`requireReconciledEngines(cwd)` in `rules/engine-gate.ts` throws a `CLIError` with `RULES_ENGINE_MISMATCH`, so both callers' existing handlers render it as an envelope or prose without new code paths. It is a separate function rather than a branch inside `requireCurrentSchema`, because `migrate.ts` must not grow a dependency on rule listing, and `update --rules` calls `requireCurrentSchema` and must not be refused by the engine gate it exists to clear.

An engine is compared only when it is recorded and the project has at least one rule for it (`listRuleIds`). Without the second condition a Vale bump would block every ast-grep-only project until it walked a ledger with nothing in it.

Comparison is by inequality, with `compareVersions` picking the message. Any difference is a mismatch: a patch-level engine bump can move matching semantics as easily as a minor one, which is why the reconciliation records exact versions.

### The override grows an environment form

`hasVersionMismatchOverride()` also reads `TASKLESS_ALLOW_VERSION_MISMATCHES` (`1` or `true`). Both gates call it. The root `cli` script sets it, because this repository's `pnpm lint` runs a fresh prod build against a manifest pinned to an older release and engines recorded several upgrades ago. That is the expected state of a development checkout, and CLAUDE.md already says `pnpm cli` is deliberately not the pin. An environment variable rather than a flag in the script, because a flag before the subcommand would have to survive citty's subcommand resolution.

## Risks / Trade-offs

- [A user upgrades with `init` and CI goes red on `check` until someone runs `update --rules`] → Intended: those rules have not been reconciled for the new engines. The refusal names both commands. Engine bumps are infrequent.
- [A `devDependencies` bump without `init` refuses everywhere] → Intended under "any mismatch". The message names `init`.
- [This repository's `pnpm lint` stops exercising the gate] → Unit tests cover the gate directly, and the dogfood run keeps exercising everything after it.
- [Tests that spawn the built CLI against fixture manifests recording other versions start failing] → Fixtures that record a version for reasons unrelated to the gate get updated to record none, or the test sets the override.

## Migration Plan

None beyond the release note. Rollback is reverting the change; nothing is written to disk by either gate.
