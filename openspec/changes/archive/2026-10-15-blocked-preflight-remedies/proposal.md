## Why

The first real blocked preflight showed the remedies are the wrong set. Claude Code's auto mode refused `npx @taskless/cli-nightly@<pin> agent ok`, and the agent offered what the skill told it to: approve that one command in chat, run it yourself as `! <command>`, or add an exact-invocation allow rule.

Two of those only unblock the preflight. `!` runs `agent ok` once and leaves every later Taskless command as blocked as before, so the user has done work for a check that proves nothing about the next call. Approving "that exact command" has the same shape. Meanwhile the remedy a user is most likely to reach for, their agent's own permissions command, is not mentioned at all.

## What Changes

- The blocked-preflight guidance offers three ways forward, and the agent waits for the user's choice:
  1. The agent adds an allow rule for exactly the invocation the skill names to the agent's permission settings.
  2. The user approves it through their agent's permissions command, such as `/permissions` in Claude Code.
  3. The user approves every Taskless command manually, in chat, as the agent runs it.
- The `! <exact command>` route is dropped.
- Unchanged: stop before any work, name the exact command and that it downloads a package from npm, and never propose a rule wider than the invocation.

## Delivery shape

**Single PR.** Two skill-body paragraphs, one test, one spec delta, and a changeset edit.

## Capabilities

### Modified Capabilities

- `skill-taskless`: the blocked-preflight remedies.

## Impact

- `skills/taskless/SKILL.md`, `commands/tskl/tskl.md`: the remedy list.
- `packages/cli/test/installed-documentation.test.ts`: asserts the new remedies and the absence of the `!` route.
- `.changeset/agent-ok-preflight.md`: still unreleased, so its description is corrected in place rather than adding a second changeset.
