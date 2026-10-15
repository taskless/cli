## Why

A real session of "let's use taskless" took four user turns to reach onboarding's one question:

1. Auto mode blocked `agent ok`. The agent offered three remedies, then also asked what the user wanted Taskless to do.
2. The user picked "I add an allow rule". Auto mode refused the agent's write to `.claude/settings.local.json`, so the agent handed the user a one-line command that made the change. That worked.
3. Once the preflight passed, the agent surveyed the install and offered a menu of topics.
4. The user said "set it up", and only then did onboarding ask its question.

The goal is one approval, if one is needed, and then onboarding's single question. The two "what next?" questions repeat a request the user already made. The fallback in step 2 is worth keeping: the agent knows what its harness accepts, and the skill cannot.

The `tskl` slash command carried a second copy of the same routing and preflight guidance, kept in step with the skill by hand, and it is overhead now that a plain request reaches the skill.

## What Changes

- On a blocked command, the agent sends one message naming the command and offers three remedies: it adds the exact-invocation allow rule, and hands the user the change if the harness blocks its edit; the user approves it through their agent's permissions command (in Claude Code, `/permissions` with `Bash(<invocation>:*)`); or the user approves every Taskless command manually in chat.
- The blocked message does not ask what the user wants. Their request stands, and the agent carries it out once unblocked.
- Once `agent ok` passes, the agent goes straight to the request, without surveying the install or offering a menu.
- A request that names no task ("use", "try", or "set up" Taskless) routes to `agent onboard`, whose question is the only one asked.
- **BREAKING** The `tskl` slash command is removed. `init` stops installing it. An upgrade removes the command an older install recorded in the manifest, from the canonical store and from each tool directory, along with any empty `tskl/` directory. A symlinked `tskl/` directory is unlinked rather than deleted through. The `init --json` envelope drops `commandsInstalled` and `writtenCommands`.

## Delivery shape

**Single PR.** The skill edits and the command removal touch the same guidance, and the removal is only coherent with the skill carrying all of it. Most of the diff is deletion: the command source, its stub builder, and tests for both.

## Capabilities

### Modified Capabilities

- `skill-taskless`: the blocked-preflight remedies, routing for a request that names no task, and the command mapping removed.
- `cli-init`: no command is installed, and an upgrade removes the retired one.
- `cli-agent`: the invocation requirement no longer names the command file.
- `skills`: no `commandName` metadata, no commands directory, and the plugin declares no commands.
- `infrastructure`: the hand-authored command requirement is removed.

## Impact

- `skills/taskless/SKILL.md`: preflight and routing. The body stays within its 150-line cap.
- `commands/tskl/` deleted. `.claude-plugin/plugin.json` no longer declares commands.
- `packages/cli/src/install/`, `commands/init.ts`, `wizard/index.ts`: command writing removed; removal of recorded commands kept.
- `agent/init.md` (topic v6), the `0001` README template, and `.taskless/README.md`.
- READMEs and `dotagents.md`.
- Tests across the install suite.
- Changesets: `agent-ok-preflight` corrected in place (still unreleased); `remove-tskl-command` added as `minor`, since users of `/tskl` must change how they ask.
