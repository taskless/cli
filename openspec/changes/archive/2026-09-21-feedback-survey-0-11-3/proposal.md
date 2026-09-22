## Why

The 0.11.3 release moves the CLI to a new PostHog survey, `01a0c7b9-dfe4-0000-d05e-ce253e90a68c`, which replaces `01a0b1a0-80fb-0000-5dc1-baa4ec44e619`. The new survey was written from what the first one taught us: the questions an agent answers well on its own were required-but-often-guessed, the one question only the user can answer was required and so blocked the whole response when the user said `skip`, and two things we want to know were never asked (which agent harness is in play, and which rule has earned its keep). PostHog assigns a fresh question id per question, so the CLI's key-to-id map must be rebuilt, not edited.

The survey is now agent-first. Only one question is required, the kind of rule the user was trying to create, and the agent knows that without asking anyone. Everything else is optional, including the user's own words. A user who declines to add anything is therefore no longer a dismissal: the agent still sends its own account of the session.

## What Changes

- **`SURVEY_ID` moves to the new survey** and the question map is rebuilt for its seven questions. The cadence store is keyed by survey id, so every install sees the new survey as a fresh ask; that is the behaviour the standing spec already promises.
- **The payload schema changes shape.** `goal` is gone. `ruleKind` (required) replaces it as the one required answer. `verbatim` becomes optional. `completed`, `workedWell`, and `needsImprovement` stay, with `completed` now optional. Two optional keys are new: `agents`, the open-source agent or framework the user is working through, and `mostValuableRule`, the rule that is earning the most for the team and why.
- **A `skip` is no longer a dismissal.** The invite asks for one thing, the user's own words, and offers two replies: words or `skip`. Words go in `verbatim`; `skip`, silence, or an unrelated reply means `verbatim` is omitted, and either way the agent fetches `agent feedback` and sends its own account of the session. The other six answers are the agent's observations, which are telemetry the user has already opted into by leaving it enabled. `feedback dismiss` stays as the explicit opt-out: the invite does not offer it, but a user who says not to send anything gets exactly that, and the recipe tells the agent to point them at the telemetry switch for everything else.
- **The `feedback` and `feedback-invite` recipes are revised** to match: the invite's wording changes, the feedback recipe drops its one permitted follow-up question (it existed only to fill `completed`, which is now optional), and it explains how to fill the two new answers and what `ruleKind` means on the onboarding path.

Nothing here is **BREAKING**. The payload is read by `feedback send` from a file the same agent wrote seconds earlier from the same CLI's recipe; no consumer holds an old-shape payload across a release. `patch`.

## Capabilities

### Modified Capabilities

- `cli-feedback-survey`: the payload contract (keys, which is required), the invite's reply handling (`skip` sends rather than dismisses), and the recipes' instructions.

## Impact

- `packages/cli/src/survey/constants.ts`: new `SURVEY_ID`, new `FeedbackKey` union, new `SURVEY_QUESTIONS` map.
- `packages/cli/src/schemas/feedback.ts`: the Zod schema, which is what the recipe embeds and `feedback send` validates with.
- `packages/cli/src/agent/feedback.md` (topic v2) and `feedback-invite.md` (topic v2).
- `packages/cli/src/commands/feedback.ts`: no logic change; `buildSurveyResponse` iterates the map.
- Tests: `feedback-schema.test.ts`, `feedback-recipes.test.ts`, `feedback-command.test.ts`, `survey-invite.test.ts` where they name keys, ids, or the invite sentence.
- PostHog: `survey shown` / `survey dismissed` / `survey sent` continue under their names with the new `$survey_id`. The old survey keeps its responses; nothing is migrated.

## Delivery shape

**Single PR.** The id, the map, the schema, and the two recipes are only correct together, and the whole diff is a few hundred lines. The change archives on the same PR.
