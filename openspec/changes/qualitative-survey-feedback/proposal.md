## Why

Rule authoring and onboarding are where an agent-driven Taskless session most often goes wrong, and the only signal we have about them today is quantitative: `cli_agent` says which recipe was fetched, `cli_run` says whether the command exited zero. Neither says what the person was trying to do, whether they got it, or what the agent stumbled on along the way. A PostHog survey exists for exactly that (`01a0b1a0-80fb-0000-5dc1-baa4ec44e619`), but nothing in the CLI can show it: there is no web surface, and the survey's questions are addressed to the agent as the respondent, relaying the user's words and its own observation of the session.

## What Changes

- **A survey invite is appended to four served recipes** (`onboard`, `create-sg-rule`, `create-vale-rule`, `create-remote-rule`) when telemetry is enabled, the run is not in CI, and the survey's `next_ask` timestamp under the XDG config directory has passed. Serving the invite captures `survey shown` and pushes `next_ask` out 10 days. Both serving paths for onboarding (`taskless onboard` and `taskless agent onboard`) carry the invite.
- **A new `feedback` subcommand** with two verbs. `feedback dismiss` captures `survey dismissed` and pushes `next_ask` out 20 days. `feedback send --from <file>` validates a JSON payload against a Zod schema, maps its human-keyed fields to the survey's question identifiers, captures `survey sent`, and pushes `next_ask` out 20 days. Under a disabled telemetry client both verbs report that nothing was sent and exit zero. `feedback` is deliberately absent from the `agent` topic index: the invite is the only door, pending a general-purpose feedback channel that would refactor this.
- **A new `feedback` recipe** (`taskless agent feedback`) that tells the agent how to fill the payload: the user's words verbatim, what they were trying to accomplish, whether they completed it (`Yes` / `No` / `Unknown`), and optionally what worked and what did not. The schema is embedded through the existing `%(INPUT_SCHEMA)s` mechanism. A companion `feedback-invite` recipe carries the appended text, rendered header-less, so the prose sits under the same Vale rules as every other recipe.
- **The three survey events carry exactly PostHog's keys.** Event names, `$survey_id`, and `$survey_response_<question id>` are PostHog's contract and are used as-is, with no survey-specific property of our own; they are the one exception to the `cli_` prefix rule. The standard super-properties ride along the way they do on every capture, which is what lets `cliVersion` split responses by release.
- **Migration `0007` ignores `.taskless/.tmp-*`.** The feedback recipe writes `.taskless/.tmp-feedback.json` the way the rule recipes write `.tmp-rule-request.json`, and a forgotten scratch file should be a stray rather than a commit. Past migrations are not edited; a fresh scaffold runs `0001` through `0007` in sequence and arrives at the same place.

Nothing here is **BREAKING**. The scaffold version moves 6 → 7, which is a `patch` bump at `0.y.z`: it adds an ignore line, changes no on-disk shape a consumer reads, and is idempotent.

## Capabilities

### New Capabilities

- `cli-feedback-survey`: the survey invite gate and cadence store, the `feedback send` / `feedback dismiss` verbs and their payload contract, the `feedback` and `feedback-invite` recipes, and the three survey events.

### Modified Capabilities

- `analytics`: the `cli_` prefix requirement gains its one exception, the three PostHog survey event literals, and states what rides on them.
- `cli`: the `.taskless/.gitignore` requirement enumerates `/.tmp-*` alongside the two entries it already names.
- `cli-taskless-bootstrap`: a new requirement for migration 7, which adds the `/.tmp-*` ignore without editing migration 1.

## Impact

- `packages/cli/src/commands/agent.ts` and `commands/onboard.ts`: call a shared gate after `getRecipe()` returns. `src/prompts/recipes.ts` is untouched; the `@taskless/cli/prompts` export never carries an invite.
- `packages/cli/src/commands/feedback.ts` (new), `src/commands/names.ts` (`feedback` joins `SUBCOMMAND_NAMES`), `src/index.ts` registration, and `UNLISTED_COMMANDS` in `agent.ts`.
- `packages/cli/src/schemas/feedback.ts` (new) plus a `TOPIC_INPUT_SCHEMAS` entry; `src/survey/` (new) for the survey constants, question map, gate, and `next_ask` store.
- `packages/cli/src/agent/feedback.md` and `feedback-invite.md` (new); `INTERNAL_TOPICS` in `src/prompts/index.ts`.
- `packages/cli/src/filesystem/migrations/0007-ignore-scratch-files.ts` (new) registered in `migrate.ts`.
- PostHog: three new event names in the project, each carrying PostHog's survey keys and the standard super-properties. No dashboard depends on them yet.
- Tests: the existing `agent`/`prompts` byte-parity suite keeps passing because tests run with telemetry disabled and the gate is telemetry-first; new suites cover the gate, the store, the two verbs, the schema, and the migration.

## Delivery shape

**Stacked, merging forward, four PRs.** Nothing triggers a survey until the tip lands, so each slice is safe on `main` by itself:

1. Migration `0007` and the `cli` / `cli-taskless-bootstrap` deltas. The changeset lives here.
2. The `feedback` subcommand, the payload schema, the survey constants, and the `next_ask` store. Reachable only by someone who types it.
3. The `feedback` and `feedback-invite` recipes. The schema they embed exists from (2).
4. The gate and injection in `agent` and `onboard`, and the `analytics` delta. This is the switch-on, and it archives the change.

Each PR extends the one changeset on the bottom branch.
