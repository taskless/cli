## Why

0.13.1 taught the installed skill to run each Taskless command as its own shell call, with nothing chained around it. That rule lives only in `skills/taskless/SKILL.md`. An agent deep in a recipe such as `onboard` or `report` is reading that recipe, and copies the recipe's own command examples, so chaining (`S=... && mkdir -p $S && npx @taskless/cli@...`, `echo ======` separators) creeps back in, and with it the auto-mode refusals and the zsh drop that 0.13.1 fixed. Two recipes still show a chained example themselves: `check` substitutes `$(git diff ...)` into the command line, and `create-vale-rule` pipes `check --json` into `jq`.

## What Changes

- Every standalone recipe carries the same short paragraph directly beneath its `# Topic:` header: run each Taskless command as its own shell call, start the line with the invocation, chain nothing to it, read output from the call's result, and write files with the agent's file tools.
- The paragraph is rendered from one `%(ONE_COMMAND_PER_CALL)s` placeholder, built from the same invocation `%(TASKLESS_CLI)s` resolves to, so the wording cannot drift between recipes.
- `check` tells the agent to run `git diff --name-only` as its own call and pass the paths it printed, instead of substituting it into the command.
- `create-vale-rule` measures one rule with `check --json --rule <id>` (which shipped for taskless/cli#379) instead of piping the whole-project result into `jq`.
- Every changed topic's version bumps, so an agent holding a cached recipe refetches.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-agent`: every recipe states the one-command-per-call rule beneath its header.

## Impact

- `packages/cli/src/prompts/recipes.ts`: the `ONE_COMMAND_PER_CALL` variable.
- `packages/cli/src/agent/*.md`: the placeholder in all 26 standalone recipes (not the `feedback-invite` fragment, which is appended under a recipe that already carries it), topic version bumps, and the two rewritten examples.
- Tests: a `prompts.test.ts` case asserting every topic's rendering carries the paragraph; topic-version assertions in `onboard.test.ts` and `report.test.ts`.
- Delivery shape: **single PR**. One placeholder and its use across the recipes, small enough to review together.
