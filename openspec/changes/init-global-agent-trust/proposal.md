## Why

A user onboarding in Claude Code's auto mode was stopped at `npx @taskless/cli-nightly@<version> info --json`, which the classifier labelled "Code from External", even though `.claude/settings.json` allowed exactly that invocation. Auto mode does not trust a project allow rule that runs downloaded code, and it does not read the `autoMode` section from a checked-in project file at all, so nothing `init` writes into the repo can clear it. The user already made that trust decision when they ran `npx @taskless/cli init`; the classifier cannot see it, because it judges only the session. The only place that decision can be carried into the session is the user's own settings, and the only moment a human is present to make it is the interactive install.

The same investigation showed the project files drifting: an older Taskless rule for a previous nightly sat next to the current one, because it was added through the skill's fallback rather than by `init`, so the manifest never recorded it and an upgrade left it in place. A pinned rule for a version that is no longer installed allows nothing anyone wants.

## What Changes

- **Project permission files hold exactly one Taskless rule.** `init` removes every Taskless allow rule in a harness file it manages, whatever version it names and whether or not the manifest recorded it, and writes the rule for the installed invocation. Each removal is reported as a `REMOVE:` line. Deny rules and non-Taskless entries are never touched. **BREAKING** for the current spec: a Taskless rule the user wrote no longer survives an upgrade.
- **A per-harness global trust slot.** For a harness whose safety classifier can overrule a project allow rule, the interactive wizard offers to write one entry to that harness's user-level settings. Only Claude Code is implemented: a top-level `autoMode.allow` entry in `~/.claude/settings.json`, labelled `Taskless CLI:`, that names no version and states that a call is covered only when it names an exact version. When `init` creates the `allow` list it seeds it with `"$defaults"`, so the shipped exceptions stay in force.
- **Written once, confirmed separately, interactive only.** The entry is found by its label, so a later install sees it and leaves it alone. The wizard shows it in its summary as an edit to a file outside the project and asks for its own confirmation. `--no-interactive` never writes outside the project. Nothing about it is recorded in the repository manifest, which is shared by everyone who clones the repo.
- **A warning when it is missing.** Both modes read the user file and, when the entry is absent, print a warning naming the file and the entry to add.
- **The skill's blocked-command fallback is self-contained.** When a Taskless command is refused by an agent's safety classifier, the installed skill tells the agent to stop, not retry, and give the user the global entry, inline. It cannot point at an `agent <topic>` recipe, because the recipe is fetched through the same blocked `npx` call. For Claude Code's auto mode it stops offering a project allow rule, which the classifier overrules.

## Capabilities

### New Capabilities

- `agent-global-trust`: the user-level trust entry for harnesses whose classifier overrules project allow rules: which harnesses have one, its wording, how it is detected, when it is offered and written, and the warning when it is absent.

### Modified Capabilities

- `cli-init`: the manifest-recorded-rules requirement becomes "exactly one Taskless rule per permission file", removing unrecorded Taskless rules; the permission-edit report gains the user-level file.
- `skill-taskless`: the blocked-preflight fallback distinguishes a classifier refusal, carries the global entry inline, and drops the project allow-rule offer where the classifier overrules it.

## Impact

- `packages/cli/src/install/permissions.ts`: per-harness recognition of a Taskless rule in each file format (including the `Bash(<invocation>:*)` form the skill used to propose); removal of unrecorded Taskless rules; the global trust slot and its Claude Code implementation.
- `packages/cli/src/wizard/index.ts`, `wizard/steps/summary.ts`: preview and separate confirm for the user-level edit.
- `packages/cli/src/commands/init.ts`: the missing-entry warning in `--no-interactive`; the `--json` envelope gains the global trust outcome.
- `packages/cli/src/agent/init.md` (the `init --json` shape) and the installed skill body template.
- Tests in `packages/cli/test/permissions.test.ts` and the wizard and skill-body tests. No home-directory writes in tests: the user settings path is injected.
- Delivery shape: **single PR**. The pieces are only meaningful together (the warning, the wizard offer, and the skill fallback all point at the same entry), and the whole change fits one reviewable diff.
