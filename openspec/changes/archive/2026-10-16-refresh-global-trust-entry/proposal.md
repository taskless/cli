## Why

A user onboarding in Claude Code's auto mode had a `Taskless CLI:` entry in `autoMode.allow` and was still stopped. The agent had wrapped the pinned call in shell plumbing to stash its output, `S=<scratchpad> && mkdir -p $S && npx @taskless/cli@<version> …`, and the classifier refused it as `[Untrusted Code Integration]`. The entry speaks of "running" the package, so a command line that starts with something else, and writes the downloaded tool's output somewhere, is not obviously what it covers. The skill's fallback then told the user to add the entry they already had, which is wrong advice and the end of the onboarding.

The user's entry was also not the current text. It was hand-copied from an earlier fallback message, and since a present entry is never rewritten, no install or update could ever bring it up to date. Any improvement to the wording reaches only users who do not have an entry yet.

## What Changes

- **The skill body tells the agent to run every Taskless command on its own.** The command line starts with the pinned invocation and has nothing chained to it: no variable assignment, `cd`, `mkdir`, `&&`, `;`, pipe, or redirect. Output is read from the call's result; a file a recipe asks for is written with the agent's file tools. This is the fix for the refusal itself.
- **The classifier fallback distinguishes a present entry.** When `autoMode.allow` already holds a `Taskless CLI:` entry, the agent does not tell the user to add it. It says the entry is present, names the refused command, and, when that command was not a standalone invocation, reruns it as one; a standalone call refused anyway goes to per-command approval or running the wizard to refresh the entry.
- **The entry text is widened, narrowly.** It additionally says the Taskless call stays covered when the same command line also sets a variable, changes or creates a directory, or redirects the call's output to a file, and that every other command on the line is judged on its own. Running at an exact version stays required; dist-tags, ranges and unversioned calls stay uncovered.
- **Install and update refresh an out-of-date entry.** An entry is `stale` when it carries the `Taskless CLI:` label and its text differs from the current entry. The wizard (both a first install and an update, since updating is running the bare CLI) shows a `REPLACE (global):` line and replaces it under the same one confirmation it already asks. **BREAKING** for the current spec, which says a present entry is never rewritten: the label is Taskless's, and an entry carrying it is Taskless's to keep current, with the user's yes.
- **`init` still never writes outside the project.** It warns when the entry is stale as it does when it is absent, and `init --json` reports `state: "stale"`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-global-trust`: the entry's wording gains the shell-plumbing sentence; detection gains a `stale` state; the wizard offers to replace a stale entry; the missing-entry warning covers a stale one.
- `skill-taskless`: the body requires standalone Taskless commands, and the classifier-refusal fallback handles an entry that is already present.

## Impact

- `packages/cli/src/install/global-trust.ts`: the entry text, the `stale` state, replacement in place of the stale string, the summary line and warning for it.
- `packages/cli/src/wizard/index.ts`, `packages/cli/src/wizard/steps/summary.ts`: a stale entry counts as a settings edit and is written on confirm.
- `packages/cli/src/agent/init.md`: the `globalTrust[].state` values gain `stale`.
- `skills/taskless/SKILL.md`: the standalone-command rule, the present-entry fallback, and the new entry text inline.
- Tests: `packages/cli/test/global-trust.test.ts`, `wizard-integration.test.ts`, `init-no-interactive.test.ts`, `installed-documentation.test.ts`. User settings stay injected; no test touches the real home directory.
- Delivery shape: **single PR**. The three pieces share one entry text and one fallback, and together are a few hundred lines.
