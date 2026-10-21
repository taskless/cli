## Why

A Codex user on 0.13 did not find Codex in the tool list and picked `.agents` only because they happened to know Codex reads it; OpsIn said the same earlier ("I didn't see it by default so I didn't think it's available"). Users know which harness they run, not which skill directory it reads. `80f3934a` merged the Codex row into one `.agents/` row labelled with detected harnesses, which falls back to "Agent Skills" when nothing is detected and names no harness at all (#553).

## What Changes

- The wizard's tool step offers **one row per harness**: Claude Code, Codex, Cursor, OpenCode, Gemini CLI, Crush, Devin, plus a generic "Other Agent Skills harnesses" row for `.agents/`. Several rows can share a directory; the install plan still has one target per directory.
- The rows are grouped with `groupMultiselect` into **Detected in this project**, **Detected on this machine**, and **Other harnesses**. Project-detected rows are pre-checked; machine-detected rows are listed unchecked; a harness found in both places appears once, in the project section.
- **Machine detection** checks each harness's documented home-directory location, honouring its documented environment override. It changes only which section a row appears in. Installing stays project-local: nothing is written outside the project because of it, and `update`, the manifest and the version pin behave as before.
- **Devin** joins the catalog: detected by `.devin/` in the project and `~/.config/devin/` on the machine. Its docs place project skills in `.devin/skills`, and it also reads `.agents/skills`, so it installs into `.devin/` when the project has `.devin/` and into `.agents/` otherwise.
- **Claude Code always installs into `.claude/`.** Claude Code never reads `.agents/` (code.claude.com/docs/en/memory: "Not read: … anything under a `.agents/` directory"), so the multi-harness Claude row the issue floated is not offered.
- **Checking the Codex row writes Codex's permission rule.** Today `.codex/rules/taskless.rules` is written only when `.agents/` is picked and `.codex/` already exists. `--no-interactive` keeps using project detection, which the written rules file itself satisfies on later runs.
- `agentsRowLabel` and the "one row per directory" reasoning at `SHIM_TARGETS` are removed; the comment records why a row per harness is what makes a harness discoverable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-init`: the location step offers a row per harness in three sections; machine-level detection; Devin detection and install directory; Codex's permission rule follows the Codex row.

## Impact

- `packages/cli/src/install/install.ts`: harness catalog gains home signals and Devin; `SHIM_TARGETS` gains `.devin`; comment at the old line 179 rewritten.
- `packages/cli/src/wizard/steps/locations.ts`: rows, sections, pre-check and hints; `promptLocations` returns directories and checked harnesses.
- `packages/cli/src/wizard/index.ts`, `packages/cli/src/commands/init.ts`, `packages/cli/src/install/permissions.ts`: Codex rule driven by the selection.
- Tests: `test/wizard-steps.test.ts`, `test/install.test.ts`, permissions tests.
- Delivery shape: single PR. The change is one reviewable diff, safe on its own, with a `patch` changeset (pre-1.0, no consumer must react).
