## Why

`agent ok` tells the agent not to run any of its steps. That is right for moving the CLI, which is the user's decision and runs newly published code. It is more than the rules step needs. Once the user has upgraded, the rules step runs the version the project already records, and walking that recipe is ordinary agent work. Today the agent hands that step back too, so an upgrade stops halfway unless the user also does the reconcile.

## What Changes

- **The user upgrades.** The cli and skill steps stay the user's. They name `init`, and say that in a terminal the same command without `init` opens the installer and its options.
- **Then the agent applies the rules step.** On its own, the rules step is the agent's: it runs the command and follows the recipe to the last step, and hands it to the user only if the command is refused. Beside a cli or skill step, it waits for the confirming `agent ok`, because a newer CLI can owe a different reconcile.
- **A launcher run names `npx` for the upgrade.** The cli step printed an agent-fill marker there, because the launcher is not a package runner.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-agent`: `agent ok` says who runs each step, and names `npx` for the upgrade on a launcher run.
- `skill-taskless`: the skill leaves upgrades to the user and applies the rules step.

## Impact

- `packages/cli/src/install/freshness.ts`, `src/prompts/recipes.ts`, `src/commands/agent.ts`, `src/util/package-manager.ts`.
- `skills/taskless/SKILL.md`.
- Replaces the "the agent never runs the steps" decision in `agent-ok-update-notice` for the rules step only.
- Delivery shape: **single PR**. It sits on #608, which changes the same spec requirement.
