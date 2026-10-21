## 1. Override and error codes

- [x] 1.1 Add `CLI_VERSION_MISMATCH` and `RULES_ENGINE_MISMATCH` to `CLIErrorCode` with comments naming each remedy; verify `pnpm typecheck` passes
- [x] 1.2 Make `hasVersionMismatchOverride()` also honour `TASKLESS_ALLOW_VERSION_MISMATCHES` (`1`/`true`); verify with a unit test covering flag, env, and neither
- [x] 1.3 Set `TASKLESS_ALLOW_VERSION_MISMATCHES=1` in the root `cli` script; verify `pnpm check:style` still passes once the gates land

## 2. Version-pin gate

- [x] 2.1 Add `install/version-gate.ts`: resolve the recorded version for this build's package, decide exemptions, and build the refusal message by direction; verify with unit tests for match, newer, older, other-channel-only, no manifest, no recorded version, unreadable manifest, `self` build, and override
- [x] 2.2 Call the gate from `index.ts` after the help/version intercepts and before dispatch, rendering a JSON envelope under `--json`; verify with a spawned-CLI test that `check` is refused and `info`/`init` are not

## 3. Engine-version gate

- [x] 3.1 Add `rules/engine-gate.ts` with `requireReconciledEngines(cwd)`, comparing only engines that are recorded and have rules; verify with unit tests for behind, ahead, unrecorded, no rules for the engine, and override
- [x] 3.2 Call it from `check` and `verify` beside `requireCurrentSchema`; verify a spawned `check --json` reports `RULES_ENGINE_MISMATCH` and that `update --rules` clears it

## 4. Fallout and release

- [x] 4.1 Run the full CLI test suite and fix fixtures that record versions unrelated to the gates; verify `pnpm test` passes
- [x] 4.2 Update the `update` recipe or docs that describe upgrading so they say upgrades go through `init` and the launcher; verify the prompt parity tests pass
- [x] 4.3 Add a `patch` changeset describing both refusals and the override; verify `pnpm typecheck` and `pnpm lint` pass
