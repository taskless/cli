## Context

`taskless init` is the install path an agent takes, and until now the same word also launched the wizard when a TTY happened to be attached, with `--no-interactive` to force the batch path. The batch path ends with a per-target summary, a migration notice on stderr, a reload banner when the version moved, and the onboarding trailer. Under `--json` it prints `{ success, commandsInstalled, migrated? }`. The `agent init` recipe addresses a human. Recipes open with a one-line `# Topic:` header that `PromptOptions.header: false` strips. The skill body tells an agent to fetch a recipe before acting but says nothing about fetching it again.

## Goals / Non-Goals

**Goals**

- One spelling per reader: bare invocation for a person (wizard), `init` for an agent or script (batch, always), `agent init` for the recipe that explains the second to the first.
- An agent that ran `init` can tell, from stdout or the envelope alone, that files changed, where, and whether `update` is the next step.
- The `agent init` recipe reads as instructions for the agent that runs the command.
- Everything the `agent` subcommand serves says it is not reusable across tasks; the skill says the same.

**Non-Goals**

- Committing on the agent's behalf. `init` reports, and the recipe tells the agent to tell the user; nobody runs git.
- Reworking the reload banner or the onboarding trailer's wording.
- Changing the interactive wizard's output. Its reader is a person watching a terminal.
- A general "session state" mechanism for recipes. The directive is prose.

## Decisions

### `init` is always the batch install, and `--no-interactive` is gone

The flag existed so that a TTY could still get the batch path. With the wizard reachable only from a bare invocation, `init` has one behaviour in every context and the flag has nothing left to select. It is removed from the command definition rather than kept as a documented no-op: citty passes an undefined flag through, so a script that still spells it out gets `init` unchanged, and there is no second flag to explain. The bare TTY invocation in `index.ts` calls `runWizard` directly instead of delegating to `initCommand`.

### The upgrade trailer prints first, directly after the summary

A reload, and anything the onboarding line proposes, come after the upgrade is understood: a reload is required before onboarding can use the new skill, and the commit obligation exists whether or not the user onboards. So the trailer is the first of the trailing notices, before the reload banner. The onboarding trailer stays the final line, which the existing requirement and its six scenarios pin.

### Changed directories are named, not files

The install result reports skill and command names per target, not paths, and deriving paths would re-implement the layout the install module already knows. The trailer names target directories (`.claude/`, `.taskless/`) plus `.taskless/` when a migration ran or the version moved, which is what a `git add` needs. Migration file paths are already listed in the migration notice, and on the envelope under `migrated.files`.

### The envelope mirrors the human summary rather than a new shape

`targets` on the envelope is the per-target summary with the same fields the human path prints, which closes the gap the existing code comment describes ("this per-target summary is not on that envelope, so rather than drop it, it goes to stderr"). `cliVersion.previous` is `null` rather than absent when nothing was recorded, so a consumer can distinguish "fresh project" by value. `changed` is derivable from the other fields and is included anyway: it is the single value an agent gates its next step on, and asking each consumer to fold three lists, a presence check, and a version comparison is how one of them gets it wrong.

### A version move is a change; an identical canonical write is not

The version-moved test is the reload banner's (`previousCliVersion !== undefined && previousCliVersion !== cliVersion`), so the banner and the `update` pointer never disagree. A move rewrites `install.cliVersion` in `taskless.json`, a tracked file, so it counts even when no skill byte changed.

The opposite case needed fixing too. The canonical store was rewritten on every install and reported as written every time, so a no-op re-install looked like an upgrade in the summary and would have fired the trailer. `writeCanonicalSkill`/`writeCanonicalCommand` now compare bytes and return `{ path, changed }`.

### The directive is rendered on the `agent` command's request, not written into recipe files

Twenty recipe files carrying an identical line invited twenty paraphrases, and the line would be false for a consumer reading a recipe through `@taskless/cli/prompts`, which has no CLI to re-run. So `RecipeOptions.directive` (default `false`) inserts it as line 2 of the header block, `commands/agent.ts` and the `update` command pass `true`, and the prompts export never does. The invocation in the directive comes from the same `resolveInvocation` that renders `%(TASKLESS_CLI)s`, so the command an agent is told to re-run is the one that served it. It also says a session that installed or upgraded Taskless holds a stale skill, since the recipe is the one text such a session receives fresh.

Living in the header block means `stripHeader` drops it with the version: the function now strips through the first blank line rather than a fixed line count, with the same first-line `# Topic:` anchor so a header inside a fenced example is left alone. Parity between the export and the command is stated modulo that option, and a consumer that passes `directive: true` gets exactly what the command prints.

### The skill directive is a section, budgeted against the cap

The body is 72 lines against an 80-line cap. The directive is a heading and five lines. The `tskl` command has no cap and gets the same paragraph.

## Risks / Trade-offs

- **`taskless init` in a TTY no longer prompts.** That is the one behaviour a person can notice, and it is the point: `init` means the same thing everywhere. The README and the non-TTY preamble both name the bare invocation for the wizard.
- **Tests that pin `init --json` to an exact object** fail on the new fields. Those are updated to assert the fields they care about, and the new fields get their own assertions. No consumer parses `init --json` outside this repository's tests today.
- **A recipe rendered with `header: false` loses the directive.** That is the intent: that rendering is for a consumer embedding the text in its own prompt, where "re-run the CLI" is the wrong instruction.
