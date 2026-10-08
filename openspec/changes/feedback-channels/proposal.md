## Why

Feedback from the CLI today goes one way: the rule-authoring survey the CLI invites after an onboarding or authoring recipe. A user who wants to tell the Taskless team something else, or report a bug, has no path from their agent short of a GitHub issue, which needs a GitHub account and leaves the agent's view of the session behind. The `taskless agent` index already anticipated this: `feedback` was held out of it "until a general feedback channel exists". This change builds that channel and a bug-report channel beside it, and renames the invited survey so the three do not share one name.

## What Changes

- The invited rule-authoring survey is renamed from `agent feedback` to `agent rule-feedback`. Its PostHog survey (`01a0c7b9-dfe4-0000-d05e-ce253e90a68c`), questions, invite, cadence, and `feedback dismiss` are unchanged. It stays out of the `taskless agent` index.
- New `agent feedback` recipe for general product feedback, sent to PostHog survey `01a11da4-3948-0000-4ae4-c9da9321801e` ("Feedback", "Attach any additional context"). Listed in the `taskless agent` index.
- New `agent bug-report` recipe for bug reports, sent to PostHog survey `01a11da7-27a2-0000-0f4e-6d3e1f89f385` (summary, version information, what the user was trying to do, expected result, actual result, additional context). Listed in the `taskless agent` index. No GitHub account is needed.
- `feedback send --from` accepts a payload discriminated by a required `kind` field (`rule`, `general`, `bug`), validated by zod, and maps each kind to its own survey and question identifiers. **BREAKING** for the payload only: a rule-feedback payload must now carry `kind: "rule"`. The recipe that writes the payload ships in the same binary, so no released agent flow writes the old shape against a new CLI.
- The bug survey's version-information answer is filled in by the CLI from local, non-identifying state, never written by the agent.
- General feedback and bug reports are user-initiated: they neither read nor write the invite cadence, and both recipes require the agent to show the user the payload and get an explicit yes before sending.
- With telemetry disabled, `feedback send` for any kind sends nothing, says that telemetry is off, and points the user to `https://github.com/taskless/cli/issues`. Both new recipes tell the agent to relay that.
- The Taskless skill (`skills/taskless/SKILL.md`) gains triggers and topic rows for sending feedback and reporting a bug.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli-feedback-survey`: grows from one invited survey to three feedback channels. The `feedback` subcommand, payload, and recipe requirements change; new requirements cover the general and bug channels, their consent step, and the telemetry-off redirect. Invite and cadence requirements are unchanged except for the recipe name the invite points to.

## Impact

- `packages/cli/src/survey/constants.ts`: one survey registry instead of a single `SURVEY_ID`.
- `packages/cli/src/schemas/feedback.ts`: discriminated union over `kind`.
- `packages/cli/src/commands/feedback.ts`: per-kind mapping, cadence only for `rule`, telemetry-off message, CLI-filled version information.
- `packages/cli/src/commands/agent.ts`: `UNLISTED_COMMANDS` drops `feedback`; `rule-feedback` is withheld from the index as a topic.
- `packages/cli/src/agent/`: `feedback.md` → `rule-feedback.md`; new `feedback.md` and `bug-report.md`; `feedback-invite.md` points at `rule-feedback`.
- `packages/cli/src/prompts/recipes.ts` and `prompts/index.ts`: input-schema map and `INTERNAL_TOPICS`.
- `skills/taskless/SKILL.md`.
- Tests: `feedback-command`, `feedback-schema`, `feedback-recipes`, `survey-invite`, `prompts`.
- PostHog: no survey changes. All three surveys exist and are active.

## Delivery shape

**Stacked, merging down.** The rename, the schema discriminator, and the two new recipes are only coherent together: an intermediate layer would ship, for example, a `feedback send` that requires `kind` while the recipe the invite names still describes one survey, or a `taskless agent` index listing a `bug-report` topic before the skill routes to it. So the stack lands on `main` in one protected merge, after each layer merges down into its parent. The layers, bottom to top: this proposal and the changeset; the survey registry and payload schema; `feedback send` per-kind behavior; the recipes and agent index; the skill; the archive. One `patch` changeset on the bottom layer, since the package is pre-1.0 and the payload change is internal to one binary.
