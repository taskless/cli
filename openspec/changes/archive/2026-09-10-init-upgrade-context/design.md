## Context

`taskless init --no-interactive` is the install path an agent takes. It ends with a per-target summary, a migration notice on stderr, a reload banner when the version moved, and the onboarding trailer. Under `--json` it prints `{ success, commandsInstalled, migrated? }`. The `init` recipe addresses a human. Recipes open with a one-line `# Topic:` header that `PromptOptions.header: false` strips. The skill body tells an agent to fetch a recipe before acting but says nothing about fetching it again.

## Goals / Non-Goals

**Goals**

- An agent that ran `init` can tell, from stdout or the envelope alone, that files changed, where, and whether `update` is the next step.
- The `init` recipe reads as instructions for the agent that runs the command.
- A recipe and the skill both say the recipe is not reusable across tasks.

**Non-Goals**

- Committing on the agent's behalf. `init` reports; it does not run git.
- Reworking the onboarding trailer or the reload banner. Both keep their position and wording.
- Changing the interactive wizard's output. Its reader is a person watching a terminal.
- A general "session state" mechanism for recipes. The directive is prose.

## Decisions

### The upgrade trailer sits before the onboarding trailer

The onboarding-trailer requirement makes that trailer the final line of output, and several tests pin it. The upgrade trailer prints after the install summary and reload banner, and before the onboarding line. An agent reads all of stdout, so ordering costs nothing; keeping the existing requirement intact avoids retesting six scenarios for a cosmetic reorder.

### Changed directories are named, not files

The install result reports skill and command names per target, not paths, and deriving paths would re-implement the layout the install module already knows. The trailer names target directories (`.claude/`, `.taskless/`) plus `.taskless/` when a migration ran, which is what a `git add` needs. Migration file paths are already listed in the migration notice, and on the envelope under `migrated.files`.

### The envelope mirrors the human summary rather than a new shape

`targets` on the envelope is the per-target summary with the same fields the human path prints, which closes the gap the existing code comment describes ("this per-target summary is not on that envelope, so rather than drop it, it goes to stderr"). `cliVersion.previous` is `null` rather than absent when nothing was recorded, so a consumer can distinguish "fresh project" by value. `changed` is derivable from the other fields and is included anyway: it is the single value an agent gates its commit step on, and asking each consumer to fold three lists and a presence check is how one of them gets it wrong.

### The version-moved condition is the reload banner's

`getReloadNotice` already answers "did this run move the recorded version" with `previousCliVersion !== undefined && previousCliVersion !== cliVersion`. The `update` pointer uses the same test, so the banner and the pointer never disagree about whether an upgrade happened.

### The refusal picks its wording from `stdout.isTTY`

`requireCurrentSchema` has no argument for interactivity and adding one to every reader would thread a flag through `check`, `verify`, and `test` for a single string. Reading `process.stdout.isTTY` in the message builder is the same test `init` itself uses to decide between wizard and batch, so the refusal and the command it points at agree.

### The directive is the header block's second line

Putting the directive in the header rather than the body keeps two properties: a header-less rendering (the cache-stable prompt) does not carry an instruction to run a CLI the consumer may not have, and the directive is dropped and added by one function. `stripHeader` changes from "first line plus one blank" to "through the first blank line", with the same first-line anchor so a `# Topic:` inside a fenced example is still untouched. The `.txt` spelling in the format requirement was stale (the files are `.md`); the MODIFIED block corrects it.

### The skill directive is a section, budgeted against the cap

The body is 72 lines against an 80-line cap. The directive is a heading and five lines. The `tskl` command has no cap and gets the same paragraph.

## Risks / Trade-offs

- **Tests that pin `init --json` to an exact object** fail on the new fields. Those are updated to assert the fields they care about, and the new fields get their own assertions. No consumer parses `init --json` outside this repository's tests today.
- **Every recipe file changes by one line**, which bumps nothing (the directive is not a meaningful recipe change) but shows up as 20 one-line diffs. The topic versions stay put except `init`, whose content changed.
- **A recipe rendered with `header: false` loses the directive.** That is the intent: that rendering is for a consumer embedding the text in its own prompt, where "re-run the CLI" is the wrong instruction.
