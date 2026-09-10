## Why

An agent that runs `taskless init`, usually because `check` refused a project whose scaffold is behind the CLI, is told what was written and then pointed at onboarding. Nothing tells it that the rewrite touched files under version control and belongs in its commit, or that an upgrade of the CLI is the moment `taskless update` exists for. Separately, nothing in the skill or in a recipe says a recipe is resolved at fetch time, so an agent that fetched `agent check` once in a session reuses that text for every later task in the same session, including after the very upgrade that changed it.

Both gaps are in agent-facing text and output shape that ship in the bundle, so they land together as one change.

## What Changes

- `taskless init` is the batch install in every context, and `--no-interactive` is dropped. Three spellings, three readers: `npx @taskless/cli` is the wizard for a person in a terminal; `npx @taskless/cli init` is the install and upgrade path for an agent, a script, and CI, with no flag; `npx @taskless/cli agent init` is the recipe that tells an agent how to do it. A script that still passes `--no-interactive` gets `init` unchanged, since citty passes an undefined flag through.
- `taskless init` reports an upgrade's consequences, not only its writes. On the human path, directly after the install summary and before the reload banner and the onboarding trailer, it prints an upgrade trailer whenever the run changed anything: which directories now hold changed files and that they belong in the next commit, and, when the recorded CLI version moved, that `taskless update` reports what the upgrade means for existing rules. Under `--json`, the envelope carries the same facts as fields: `cliVersion: { previous, installed }`, a per-target `targets` list of what was written and removed (the summary that today goes only to stderr), and a `changed` boolean.
- A canonical `.taskless/` file whose bytes already match the bundle is no longer rewritten or reported as written, so a no-op re-install reads as one.
- The `agent init` recipe is rewritten for its actual reader. Today it says "the user runs this themselves"; its most common caller is an agent that `check` just sent there. It describes `init`, the envelope, and what follows an install: tell the user which paths need committing (the agent does not run git), run `update` after a version move, and treat a session that predates the install as holding stale skills.
- The `agent` subcommand serves every recipe under a fetch-time directive, added by the renderer as the header block's second line: the text was resolved at fetch time, the next task fetches it again, and a session that installed or upgraded Taskless holds a stale skill until reloaded. The recipe files do not carry it, and neither does the `@taskless/cli/prompts` export, whose consumer has no CLI to re-run. `header: false` strips the block whole.
- The skill body and the `tskl` command carry the same directive: fetch the recipe for every Taskless task, even one already fetched earlier in the session. Both sources spell the CLI as `%(TASKLESS_CLI)s`, rendered at install to the build's invocation, in place of a whitespace-sensitive search for the literal `npx @taskless/cli` in prose.

Nothing here is **BREAKING**. `init` without a TTY already ran the batch install; with a TTY it ran the wizard, and that spelling now runs the batch install too, which is the one behaviour change a person can notice. The `init --json` envelope only gains fields; the human output only gains lines before an existing final line; recipe bodies are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-init`: a new requirement for the upgrade trailer and the `--json` fields it mirrors; `init` becomes the batch path and the bare invocation the wizard; the canonical-rewrite requirement says an unchanged file is not reported.
- `cli-agent`: a new requirement for the directive the `agent` subcommand serves each recipe under.
- `cli-knowledge-prompts`: parity between the export and the command is stated modulo the `directive` option.
- `skill-taskless`: the skill body includes a re-fetch directive.

## Impact

- `packages/cli/src/commands/init.ts` and `src/index.ts`: `init` always batch, the bare TTY invocation calls the wizard directly; trailer and envelope fields.
- `packages/cli/src/install/canonical.ts`: byte comparison before a canonical write.
- `packages/cli/src/agent/init.md`: rewritten and bumped to topic v2.
- `packages/cli/src/prompts/recipes.ts`: the `directive` option and the header block stripping.
- `skills/taskless/SKILL.md`, `commands/tskl/tskl.md`: the directive.
- Tests under `packages/cli/test/` for each of the above.
- A `patch` changeset: the package is `0.y.z`, and nothing here is something a consumer must react to.

Delivery shape: **single PR**. The diff is agent-facing prose, one command's output, and their tests, and it does not depend on any other open branch.
