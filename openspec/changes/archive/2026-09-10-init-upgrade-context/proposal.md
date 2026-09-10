## Why

An agent that runs `taskless init --no-interactive`, usually because `check` refused a project whose scaffold is behind the CLI, is told what was written and then pointed at onboarding. Nothing tells it that the rewrite touched files under version control and belongs in its commit, or that an upgrade of the CLI is the moment `taskless update` exists for. Separately, nothing in the skill or in a recipe says a recipe is resolved at fetch time, so an agent that fetched `agent check` once in a session reuses that text for every later task in the same session, including after the very upgrade that changed it.

Both gaps are in agent-facing text and output shape that ship in the bundle, so they land together as one change.

## What Changes

- `taskless init --no-interactive` reports an upgrade's consequences, not only its writes. On the human path, after the install summary and before the onboarding trailer, it prints an upgrade trailer whenever the run changed anything: which directories now hold changed files and that they belong in the next commit, and, when the recorded CLI version moved, that `taskless update` reports what the upgrade means for existing rules. Under `--json`, the envelope carries the same facts as fields: `cliVersion: { previous, installed }`, a per-target `targets` list of what was written and removed (the summary that today goes only to stderr), and a `changed` boolean.
- The `init` recipe is rewritten for its actual reader. Today it says "the user runs this themselves"; its most common caller is an agent that `check` just sent there. It describes the non-interactive path, the envelope, and the three things that follow an install: commit the rewritten files, run `update` after a version move, and treat a session that predates the install as holding stale skills.
- The `SCAFFOLD_MIGRATION_REQUIRED` refusal names `init --no-interactive` for a non-TTY caller, so an agent does not reach for the wizard.
- Recipes state that they are not reusable across tasks. Every recipe's header block gains a second line saying the text was resolved at fetch time and that the next task fetches it again. `PromptOptions.header: false` strips the whole header block, so a cache-stable prompt is unchanged in shape.
- The skill body and the `tskl` command carry the same directive: fetch the recipe for every Taskless task, even one already fetched earlier in the session.

Nothing here is **BREAKING**. The `init --json` envelope only gains fields; the human output only gains lines before an existing final line; the recipe body after the header block is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-init`: a new requirement for the upgrade trailer and the `--json` fields it mirrors; the existing onboarding-trailer requirement is unchanged (the upgrade trailer prints before it).
- `cli-agent`: the recipe format's header becomes a two-line header block, the second line being the fetch-time directive.
- `cli-knowledge-prompts`: `header: false` suppresses the header block, not only its first line.
- `skill-taskless`: the skill body includes a re-fetch directive.

## Impact

- `packages/cli/src/commands/init.ts`: trailer and envelope fields on the non-interactive path.
- `packages/cli/src/filesystem/migrate.ts`: the refusal message.
- `packages/cli/src/agent/*.md`: one header line per recipe; `init.md` rewritten and bumped to topic v2.
- `packages/cli/src/prompts/recipes.ts`: header stripping covers the block.
- `skills/taskless/SKILL.md`, `commands/tskl/tskl.md`: the directive.
- Tests under `packages/cli/test/` for each of the above.
- A `patch` changeset: the package is `0.y.z`, and nothing here is something a consumer must react to.

Delivery shape: **single PR**. The diff is agent-facing prose, one command's output, and their tests, and it does not depend on any other open branch.
