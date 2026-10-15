## Why

The wizard's tool picker offers `.agents/` twice: as `Codex` and as `Agent Skills`. The duplicate row exists so a Codex user sees the word "Codex", since one who saw only "Agent Skills" concluded Taskless did not support their harness. But Codex is not the only harness that reads `.agents/skills`, and a row per harness does not scale. OpenCode, Gemini CLI, and Crush all read it, and the picker names none of them.

## What Changes

- The picker offers one `.agents/` row, labelled with the detected harnesses that read `.agents/skills`, in catalog order: `OpenCode, Codex, and other .agents harnesses (.agents/)`. With none detected, it names all of them, so a Codex or Gemini CLI user still finds their harness on a fresh machine.
- The duplicate `Codex` row is removed, along with `uniqueShimTargets()`, which existed only to collapse it.
- Gemini CLI (`.gemini/`, `GEMINI.md`) and Crush (`.crush/`, `crush.json`, `.crushrc`, and variants) are detected and install into `.agents/`, each per its own docs.
- OpenCode is named on the `.agents/` row when detected, since it reads `.agents/skills`, but does not pre-check it: it already gets `.opencode/`, and both would give it the skill twice.

## Delivery shape

**Stacked, merging forward**, on top of the `pinned-cli-permissions` stack (#509, #510). The change is independent of that stack, but it edits the `init` recipe the stack also edits, so it sits on top to avoid a conflict. Safe alone in production.

## Capabilities

### Modified Capabilities

- `cli-init`: the picker's `.agents/` row and its label; Gemini CLI and Crush detection.

## Impact

- `packages/cli/src/install/install.ts`: tool registry and shim catalog.
- `packages/cli/src/wizard/steps/locations.ts`: the row label.
- `packages/cli/src/agent/init.md`: the list of detected tools (topic v9).
- Tests for the picker and detection.
- No new harness gets a permission rule: Gemini CLI and Crush are not in the permission writer's closed list.
