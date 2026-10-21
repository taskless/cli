## Why

Engine upgrades no longer carry backward-compatibility weight: rule migrations rewrite whatever an ast-grep or Vale release breaks, so a project can always take the newest engines. What still breaks is running a CLI against rules reconciled for different engines, and nothing stops that today. The only version gate is the scaffold layout number, which rule migrations deliberately leave alone, so:

- a new CLI runs its new engines against rules nobody has migrated (the ast-grep 0.51.0 Haskell rename leaves `check` with no ast-grep findings at all), and
- an older CLI, typically a `devDependencies` pin in CI, runs rules that `npx @taskless/cli@latest update --rules` already migrated past it.

## What Changes

- **BREAKING (behavior)**: The CLI refuses to run any command other than `init`, `info`, `auth`, and `feedback` when its version is not the version the project recorded for its package (`install.launchers`, falling back to `install.cliVersion`). `init` is the one command that moves the pin, so upgrading becomes `init` and everything else runs on the recorded version. This applies however the CLI was started: npx, `pnpm dlx`, a `devDependencies` install, or a stale launcher. A project with no recorded version, and a `self` build, are not gated.
- `check` and `verify` refuse to run rules when `rules.engines` in `taskless.json` names an engine version different from the one this CLI bundles. Behind asks for the ledger walk and `update --rules`; ahead asks for a CLI upgrade. A project that never recorded engines is not gated.
- Two new error codes, `CLI_VERSION_MISMATCH` and `RULES_ENGINE_MISMATCH`, so an agent can tell the two remedies apart.
- `--allow-version-mismatches`, today the escape hatch for a scaffold newer than the CLI, also skips both new gates, and can be set as `TASKLESS_ALLOW_VERSION_MISMATCHES=1`. The repo's own `pnpm cli` script sets it, since a development build is deliberately not the pinned version.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli`: adds the version-pin gate, the engine-version gate, and the environment form of the mismatch override.

## Impact

- `packages/cli/src/index.ts` (gate before dispatch), a new `packages/cli/src/install/version-gate.ts`, `packages/cli/src/rules/engine-gate.ts`, `commands/check.ts`, `commands/verify.ts`, `filesystem/migrate.ts` (override reads the environment), `types/errors.ts`.
- Root `package.json` `cli` script.
- Any user whose CI runs a pinned CLI older than the project's recorded version gets a refusal naming the fix instead of a quietly wrong scan. Ships as `patch`: the package is pre-1.0.
- Delivery shape: **single PR**. The pin gate and the engine gate are one idea (the CLI that runs must match what the project recorded), and the whole change fits one reviewable diff.
