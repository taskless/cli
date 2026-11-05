## Why

The wizard asks one question for every settings edit, so a person who wants Taskless but not an edit to `~/.claude/settings.json` can only cancel the install. The edit sits on two lines in that summary and nothing says why it is there or that it reaches past this project.

An installer that rewrites a person's global agent config without a clear opt-in is what drew the complaint in [postmanlabs/postman-app-support#14370](https://github.com/postmanlabs/postman-app-support/issues/14370). Taskless does ask, but a question that bundles the global edit with the install is not much of a choice. Skipping the edit should be a real option, because it costs little: the launcher and its pin still work, and the agent asks for approval more often.

This reverses the "one grouped settings question" decision in `agent-global-trust`.

## What Changes

- The global trust entry gets its own question, after the summary's confirmation and before anything is written.
- The question defaults to no, so Enter leaves the user's settings alone.
- The step explains why the entry is needed, what it covers, that it applies to every project on the machine, the exact text, how to undo it, and what skipping costs.
- Declining continues the install and writes nothing outside the project. Cancelling the prompt still cancels the install.
- A decline gets one calm line rather than the red `SKIPPED (global):` block. That block stays for `init`, and for a file the wizard could not edit.
- **BREAKING for no one**: `--no-interactive` and `--json` are unchanged, and the entry's text is unchanged, so no existing entry goes stale.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-global-trust`: the entry has its own opt-in question, and declining it no longer cancels the install.
- `cli-init`: the summary's confirmation covers project edits only.

## Impact

- New `packages/cli/src/wizard/steps/global-trust.ts`. `src/install/global-trust.ts`, `src/wizard/index.ts`, `src/wizard/steps/summary.ts`.
- Delivery shape: **single PR**. The prompt, the wizard flow and the spec change only make sense together, and the diff fits one review.
