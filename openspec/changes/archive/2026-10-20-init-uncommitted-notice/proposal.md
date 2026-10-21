## Why

A worktree is built from commits, and `init` commits nothing. A user whose agent opens a worktree for every session (Claude Code does this for some people) ran `init`, started the agent, and got a worktree with no `.taskless/`, no skill, and no permission entries, because all of them were still uncommitted in the main checkout. Nothing said why. Reported from 0.13 user feedback (#554).

## What Changes

- **The wizard offers to commit the install.** When the project is in a git repository and any path the install owns is untracked, modified, or staged but not committed, the wizard asks one question before its outro, with three choices: commit with `chore: Installs Taskless and sets up coding agent support`, write my own commit message, or don't commit. It does not list the files. The commit carries only those paths and leaves anything else the user had staged alone. The paths are `.taskless/`, each target's installed skill directory, and every permission file the manifest records a Taskless rule in, read from the manifest so a re-run that edited nothing still includes them.
- **The batch install says a commit is owed.** `init` without the wizard runs for agents, scripts, and CI, where nobody can answer a question, so it prints a short boxed notice above the onboarding trailer instead: commit the installed files before starting the agent, since agents that work in worktrees won't see uncommitted files. No file list, and nothing is committed.
- **The `cli-onboard` spec stops pinning the recipe's topic version.** It said v8 while the recipe was at v9. The version is recorded in the recipe header, which the spec's scenario still requires in the canonical form.
- **The onboard recipe checks for a worktree first (topic v10).** A new first step has the agent compare `git rev-parse --git-dir` with `--git-common-dir`. In a linked worktree where `.taskless/taskless.json` is not tracked, and the main checkout has a `.taskless/`, the agent stops and tells the user that `init`'s files are most likely uncommitted in their main checkout, to commit them there and start a new worktree. Tracked, not present, is the test, because the `onboard` subcommand bootstraps an empty `.taskless/` before it serves the recipe. When the main checkout has no `.taskless/` either, `init` ran in this worktree and onboarding continues.

## Capabilities

### Modified Capabilities

- `cli-init`: the wizard's commit offer, and the batch install's notice.
- `cli-onboard`: adds the worktree check as the recipe's first step, and drops the pinned topic version.

## Impact

- `packages/cli/src/install/uncommitted.ts` (new), `install/permissions.ts` (exports the recorded permission files), `commands/init.ts`, `wizard/index.ts`, `wizard/steps/commit.ts` (new).
- `packages/cli/src/agent/onboard.md`: new step 1, steps renumbered, topic v10.
- Tests: `init-no-interactive.test.ts`, `wizard-integration.test.ts`, `onboard.test.ts`.
- `--json` is unchanged: the notice is human output only, and stdout stays the envelope.
- The wizard runs `git add` and `git commit` on the user's behalf, only on their explicit choice.
- Delivery shape: **single PR**. Two small, related additions that fit one review.
