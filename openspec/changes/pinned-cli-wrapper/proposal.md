## Why

Every Taskless command an agent or CI runs is spelled `npx @taskless/cli@<version>`. Claude Code's auto-mode classifier refuses that spelling as downloaded code, even with a project allow rule. It also puts the version into every installed command, so each release rewrites the skill. A manual probe on 2026-10-19 showed the same npx call made from a project-local script, `./.taskless/bin/cli.mjs`, ran with no allowance at all, and ran reliably once an allowance named the script. Running it as `node .taskless/bin/cli.mjs` was refused as an external script. A project-local launcher gives agents a spelling the classifier accepts, and gives CI in any language one fixed command whose version is read from the project at run time.

## What Changes

- **`init` installs a launcher per package.** The release writes `.taskless/bin/cli.mjs`, and a nightly writes `.taskless/bin/cli-nightly.mjs`. Each is a small Node script, written only by its own package, that reads its package's version from `.taskless/taskless.json` when it runs and runs that exact version through `npx`. Neither build touches the other's launcher, so testing a nightly beside the release works the same way their permissions already do.
- **The manifest records one version per package.** `install.cliVersion` keeps meaning "the build that last installed". A new `install.launchers` records the version each package's launcher runs, so a nightly install no longer changes what `cli.mjs` runs.
- **The skill names the launcher.** `%(TASKLESS_CLI)s` in the installed skill renders to `./.taskless/bin/cli.mjs` (or `cli-nightly.mjs`) instead of a pinned npx call. The rendered skill no longer changes on every release. Reference stubs' recovery commands keep the npx spelling, since they exist for when `.taskless/` is gone.
- **Recipes fetched through a launcher name the launcher.** The launcher tells the CLI it was the one that started it, and `agent <topic>` renders `%(TASKLESS_CLI)s` as the launcher, so a recipe never sends an agent back to the npx spelling the classifier refuses.
- **Permissions cover the launcher.** Each harness's project rule set gains a rule for the installed package's launcher. Each package's global auto-mode entry also covers running its launcher from the project root. **BREAKING** for the current entry text: existing entries read as stale once, and the wizard offers to replace them.
- **Settings edits are reported as migrations with one color model.** `ALLOW` green, `REMOVE` in the default color, `REPLACE` yellow, and `SKIPPED` red, meaning the user has to make the edit by hand; the non-interactive global warning becomes a red `SKIPPED (global):` line. Today `REMOVE` is red and `SKIPPED` yellow.
- **Every install and upgrade folds duplicate global entries into one.** Today, when `autoMode.allow` holds more than one string under this build's label, the wizard replaces the first and leaves the rest, so a hand-pasted copy beside a wizard-written one stays forever. The wizard now leaves exactly one, inside the confirmation it already asks. `--no-interactive` still writes nothing outside the project and says how many duplicates the wizard would fold.
- **The `ci` recipe runs the launcher with `node`.** Generated CI calls `node .taskless/bin/cli.mjs check`, which needs Node on the runner but no `package.json`. The recipe tells the Taskless job to bring its own Node (a setup step, or a Node image), so a Python or Go repository can run it from a separate job.

## Capabilities

### New Capabilities

- `cli-project-launcher`: the launcher scripts. Where they live and what they are called, where they read their version, how they run the CLI and pass its exit status back, and how they fail when no version is recorded.

### Modified Capabilities

- `cli-init`: installs the launcher, records per-package launcher versions, renders the skill's invocation to the launcher, and adds launcher rules to the project permission files; the definition of a Taskless rule widens to include the launcher.
- `agent-global-trust`: each package's entry also covers its launcher, and duplicate strings under a label read as stale and are folded into one on every install and upgrade.
- `skill-taskless`: the skill says to run Taskless commands from the directory containing `.taskless/`, changing directory in a separate call, and to read a missing launcher as a wrong directory.
- `cli-agent`: recipes fetched through a launcher name it, and the `ci` recipe generates a launcher call with Node supplied by the job.

## Impact

- New template for the launcher, written by `packages/cli/src/install/` alongside the canonical skill.
- `packages/cli/src/install/state.ts`, `filesystem/manifest.ts`: the `install.launchers` field.
- `packages/cli/src/install/canonical.ts`, `util/invocation.ts`: the skill renders to the launcher path; stubs keep npx.
- `packages/cli/src/util/package-manager.ts`, `commands/agent.ts`: launcher detection for recipe rendering.
- `packages/cli/src/install/permissions.ts`: launcher rules per harness and package mapping for the launcher filenames.
- `packages/cli/src/install/global-trust.ts`: entry text.
- `packages/cli/src/agent/ci.md`: generated commands.
- Tests for each of the above, including the entry-text and installed-skill snapshot tests.
- Delivery shape: **single PR**. The launcher, its permissions, and the invocation change are only useful together, and the diff should fit one review.
