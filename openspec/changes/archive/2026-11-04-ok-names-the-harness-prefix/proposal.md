## Why

The `agent ok` passage tells every agent to offer Claude Code's `!` prefix, whichever harness it is running in. Cursor users need `/shell`, and a harness with no prefix gets advice that does nothing. The CLI can usually tell where it is running, so it can give the instruction that works there.

## What Changes

- `agent ok` recognizes the harness from environment variables and shows the upgrade command with that harness's prefix.
- `!` for the Claude Code CLI, OpenCode, Codex, Gemini CLI, and Devin. `/shell ` for Cursor, with its 30-second limit stated.
- Another terminal is always offered, and is the only offer when the harness is not recognized.
- The skill points at the report rather than naming Claude Code's prefix.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-agent`: the `ok` passage names the harness's prefix.
- `skill-taskless`: the skill defers to the report for how a person runs a step.

## Impact

- New `packages/cli/src/detect/harness-shell.ts`. `src/commands/agent.ts`, `src/prompts/recipes.ts`, `skills/taskless/SKILL.md`.
- `check`'s notice is unchanged: it prints commands for whoever reads the output, with no agent passage to carry the wording.
- Delivery shape: **single PR**, stacked on #608 with the rule-step change it extends.
