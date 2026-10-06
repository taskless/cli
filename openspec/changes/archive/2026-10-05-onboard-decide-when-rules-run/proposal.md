## Why

The onboard recipe goes straight from materializing rules to asking whether to mark onboarding complete. Nothing in between asks when the new rules will run, so a project can finish onboarding with rules that nothing ever runs. When the agent improvised the missing question, it put it in the same message as the consent-gated `--mark-complete` question, and the user's "yes" could be read as an answer to either (#441).

## What Changes

- The onboard recipe gains a step between materializing rules and marking complete: **decide when the rules run**. The agent reports what the repository already has for CI and for commit hooks, offers to wire `check` into CI (`agent ci`) and into a pre-commit hook (`agent hooks`), and does whichever the user picks. Only after that does it ask the `--mark-complete` question, in a message with no other question in it.
- The onboard recipe's See Also names `agent ci` and `agent hooks`.
- `detect --json` reports two more deterministic, on-disk signals beside `linters`: `ci`, the CI systems configured at the scan root (the same file table the `ci` recipe uses), and `hooks`, the tools that run commands at commit time (husky, lefthook, pre-commit, simple-git-hooks, lint-staged). The new fields are additive. Nothing existing changes shape.
- A new internal agent topic, `hooks`, covers running `check` on staged files before a commit, in whichever hook tool the repository already uses. It records what the agent in #441 had to work out alone: `check` takes paths and skips ones that don't exist, so a staged-file list can go straight in; `check` edits no tracked file, which is what makes lint-staged's `--no-stash` safe, and the recipe states what that flag gives up; a change under `.taskless/rules/` calls for `test` and a full `check`; and the pinned dev dependency is what keeps the hook, CI and every developer on one version.
- The `ci` recipe reads the CI systems from `detect --json` before falling back to its file table, and names `agent hooks` in See Also.
- The installed skill's topic table gains a row for `agent hooks`.

## Capabilities

### New Capabilities

None. The `hooks` topic is registered under the existing `cli-agent` capability, the way `onboard` was.

### Modified Capabilities

- `cli-onboard`: the recipe requirement gains the "decide when the rules run" step and requires the mark-complete question to be asked on its own.
- `cli-detect`: the signal list grows from linters, languages and rule styles to also include CI systems and commit-hook tools, and the JSON-shape requirement names the new fields.
- `cli-agent`: a requirement registers the `hooks` topic.

## Delivery shape

**Single PR.** One recipe step, two additive `detect` fields, and one new recipe, all landing together with their tests and spec deltas, fit well inside one reviewable diff. They are also only coherent together: an onboard step that sends the agent to `agent hooks` before that topic exists would cite a topic that does not resolve, and `recipe-cross-references.test.ts` fails on exactly that.

## Impact

- `packages/cli/src/agent/onboard.md` (topic v4 → v5), `ci.md` (v3 → v4), `detect.md` (v1 → v2), new `hooks.md` (v1).
- `packages/cli/src/detect/scan.ts` and the `detect` output schema: new `ci` and `hooks` arrays.
- `packages/cli/src/prompts/index.ts`: `hooks` joins `INTERNAL_TOPICS`.
- `skills/taskless/SKILL.md`: new topic row.
- `check.md` (v6 → v7): See Also names `agent hooks`.
- Tests: `detect.test.ts` and `onboard.test.ts`. The recipe cross-reference guard needs no new allowlist entry, because the hook's invocation is written as a marker rather than a literal command.
- No API, auth, or network change. `detect` stays offline and deterministic.
