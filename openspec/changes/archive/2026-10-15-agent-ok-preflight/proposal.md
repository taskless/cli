## Why

A harness can refuse the CLI before Taskless says a word. In a real session, Claude Code's auto mode blocked `npx @taskless/cli-nightly@<pin> agent onboard` because it downloads and runs a package from npm. The block is correct, but it landed on the first command that does work, and the one consent question onboarding asks lives inside that recipe, behind the call that was refused. The agent stopped, improvised an allow rule (`npx @taskless/cli-nightly:*`) broader than the pin it was installed with, and asked its question after the fact.

Nothing tells an agent, before it starts a task, whether it is allowed to run Taskless at all. That is cheap to find out and expensive to discover halfway through.

## What Changes

- Add `taskless agent ok`, a built-in topic that does nothing but print one line: `This message confirms you can run Taskless via <invocation>.` It reads no project state, needs no install, and exits 0. Reaching it at all is the signal.
- The `taskless` skill and the `tskl` command run `agent ok` once per session, before any other Taskless command.
- When the harness blocks that preflight, the skill tells the agent to stop before doing any work and ask the user, naming the exact command and that it downloads a package from npm. It offers three ways forward: the user approves that exact command in their reply, the user runs `! <exact command>` themselves, or the agent adds an allow rule for exactly the invocation the skill names, never a wildcard over the package name or version.
- `ok` appears in the `taskless agent` index.

## Delivery shape

**Single PR.** One built-in topic, two skill-body sections, and their tests fit one reviewable diff well under the size guidance, and none of it is useful split: the topic without the skill instruction is never called, and the instruction without the topic names a command that does not exist.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-agent`: adds the `ok` preflight topic.
- `skill-taskless`: adds the preflight step and the blocked-preflight guidance to the skill and `tskl` command bodies.

## Impact

- `packages/cli/src/commands/agent.ts`: the `ok` branch and its index row.
- `skills/taskless/SKILL.md`, `commands/tskl/tskl.md`: the preflight section. The skill body stays within its 150-line cap.
- Tests for the topic output, the index row, telemetry, and the skill body.
- A `patch` changeset (pre-1.0, additive).
- Out of scope: writing harness permission settings from the installer. Whether a narrow `npx` allow rule survives Claude Code's auto mode is undocumented, and is a follow-up to test by hand before anything depends on it.
