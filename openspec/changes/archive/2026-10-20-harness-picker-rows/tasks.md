## 1. Catalog

- [x] 1.1 Add `machine({ home, env })` to every `ToolDescriptor` per the design's table, with a source comment per harness; add `detectMachineTools(environment)`; verify with tests over a temporary home, including an override and an override naming a missing directory
- [x] 1.2 Add Devin (`.devin/` signal, `installDir: ".agents"`, `ownDir: ".devin"`) and `{ dir: ".devin", label: "Devin" }` to `SHIM_TARGETS`; resolve `ownDir` for project-detected tools in `detectSelectedDirectories`; verify with `detectTools`/`detectSelectedDirectories` tests
- [x] 1.3 Rewrite the `SHIM_TARGETS` comment (formerly `install.ts:179`) to say why a row per harness is what makes a harness discoverable; drop `ShimTarget.generic`

## 2. Picker

- [x] 2.1 Replace `agentsRowLabel` and the per-directory rows in `locationChoices` with harness rows, sections, pre-check and the `installed` hint per the spec; add pure `resolveSelection`; rewrite `test/wizard-steps.test.ts` to cover every scenario in the modified requirement
- [x] 2.2 `promptLocations` uses `groupMultiselect` (`selectableGroups: false`), takes the global-trust environment for machine detection, and returns `{ directories, harnesses }`

## 3. Codex permissions

- [x] 3.1 Replace `codexDetected` with `codex` in `SyncPermissionsOptions` and `harnessesFor`; the wizard passes whether the Codex row was checked, `--no-interactive` passes whether Codex is detected; verify with permissions tests for both new scenarios

## 4. Verification and release

- [x] 4.1 `pnpm typecheck`, `pnpm lint`, `pnpm --filter @taskless/cli test`
- [x] 4.2 Run the built wizard in a scratch project with a scratch `HOME` (Codex on the machine only), check the Codex row alone, and confirm `.agents/skills/taskless/SKILL.md` and `.codex/rules/taskless.rules` are written and nothing outside the project changes
- [x] 4.3 Add a `patch` changeset; archive the change on this PR
