## Context

See proposal.md for motivation. The constraints that shape the approach:

- `src/prompts/recipes.ts` is the single render path for every recipe and is imported by Workers without `nodejs_compat`. It must stay free of telemetry, filesystem, and `process` reads; `assert-prompts-graph` in `vite.config.ts` fails the build otherwise. Anything that reads a timestamp or captures an event lives in the command layer.
- `test/prompts.test.ts` asserts that `taskless agent <topic>` matches `getPrompt(topic, { directive: true })` byte for byte, by spawning the built CLI. The test environment sets `DO_NOT_TRACK=1` and `TASKLESS_TELEMETRY_DISABLED=1`.
- `test/recipe-cross-references.test.ts` requires every `src/agent/*.md` to open with `# Topic: <its own name>`, to name only commands that exist, and to spell no CLI invocation by hand.
- The survey (`01a0b1a0-80fb-0000-5dc1-baa4ec44e619`) is `schedule: once` with five questions. Q3 is `single_choice` with the literal choices `Yes`, `No`, `Unknown`. Its identifier changed when it became single choice; the map below is the current one.
- PostHog's custom-survey contract is three event literals (`survey shown`, `survey dismissed`, `survey sent`) and the `$survey_id` and `$survey_response_<question id>` keys. Nothing else is part of that contract.
- The telemetry opt-out is `DO_NOT_TRACK=1` or `TASKLESS_TELEMETRY_DISABLED=1`. `CI` is read elsewhere in the CLI as `CI === "true" || CI === "1"` (`util/interactive.ts`).
- Scratch input files follow `.taskless/.tmp-<thing>-request.json` with a `--from` flag and a recipe "clean up" step (`rule create`, `rule improve`). Nothing ignores them today.
- Migrations are sequential, keyed numerically, and frozen once shipped. A project at version N runs only migrations above N.

## Goals / Non-Goals

**Goals:**

- One gate, called from both recipe-serving commands, that decides whether to append the invite and owns every side effect of that decision.
- The agent never transcribes a question UUID. The payload it writes uses human keys; the CLI owns the map.
- The `prompts` export, the byte-parity test, and every existing recipe rendering are untouched.
- Test runs never emit a survey event.

**Non-Goals:**

- A general feedback channel. `feedback` is reached only through the invite for now; when a general channel exists this surface is refactored into it.
- Retiring `taskless onboard`. Both onboarding paths get the invite in this change; consolidating them is a separate change.
- Anything beyond the four listed topics. The topic set is a constant and widening it is a one-line edit later.
- Server-side survey targeting. The survey's internal targeting flag and `$survey_responded/…` person properties are unused; the CLI is the only scheduler.

## Decisions

### The gate lives in the command layer, after `getRecipe()`

`agent.ts` and `onboard.ts` both call `getRecipe()` and print. A new `src/survey/invite.ts` exports one function that takes the rendered recipe, the topic, and the invocation, and returns the text to print. Inside it: check the gate, and if open, capture `survey shown`, write `next_ask`, and append the rendered invite. The `prompts` module never sees it.

Alternative considered: a `RecipeOptions.survey` flag in the renderer. Rejected because the renderer cannot read the clock or the config directory without breaking the Workers constraint, and because the parity test would then have to reason about time.

### Gate condition, stated once

```
telemetry enabled
  && CI is not "true" or "1"
  && topic in { onboard, create-sg-rule, create-vale-rule, create-remote-rule }
  && (next_ask is absent, unparseable, or <= now)
```

"Telemetry enabled" is the same predicate `getTelemetry()` uses, exposed rather than duplicated. `CI` is checked separately because telemetry is not disabled in CI (`cli_check_completed` from CI is real signal) but a survey in CI has no one to answer it.

### `next_ask`, epoch milliseconds, keyed by survey id

Path: `<XDG config>/taskless/surveys/<survey id>/next_ask`, where the survey id is the PostHog UUID. Contents: `Date.now()` at write time plus the interval, as a decimal string. Missing or unparseable reads as "ask now", and the next write repairs it.

| Event              | Writes `next_ask` |
| ------------------ | ----------------- |
| `survey shown`     | now + 10 days     |
| `survey dismissed` | now + 20 days     |
| `survey sent`      | now + 20 days     |

Keyed by survey rather than by CLI version so the config directory does not grow a directory per release, and so a CLI upgrade does not reset the cadence: a newer CLI reads the same file and may not ask right away, which is fine. A new survey is a new id and therefore a new ask. Per-release segmentation still works because `cliVersion` rides on every capture. Dismiss and sent both earn the long gap because either is an explicit terminal action; only silence earns the short one.

Alternative considered: a JSON state file with outcome history. Rejected as more than is needed; a bare epoch is the whole state.

### `feedback send --from <file>`, `feedback dismiss`

Naming follows `rule create --from`. `feedback` joins `SUBCOMMAND_NAMES` (the `satisfies` check in `index.ts` enforces registration) and `UNLISTED_COMMANDS` in `agent.ts`, for the same reason `demo` is there: listing it invites an agent to run it unprompted. `agent feedback` still serves `feedback.md`, the way `agent check` serves `check.md` for the `check` subcommand.

Neither verb takes a topic: the survey events carry PostHog's keys and nothing of ours. Both verbs take `--dir`. Neither runs migrations or requires `.taskless/` to exist: `send` reads whatever path it is given, and neither writes into the project.

Under a disabled telemetry client both verbs print one line saying nothing was sent and exit zero. An agent should never reach them in that state, because the invite is not served in it, so this is defensive rather than a path the recipe describes.

### Payload schema: human keys, CLI-owned map

`src/schemas/feedback.ts`:

| Key                | Type                         | Question                                                                                                  |
| ------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `verbatim`         | non-empty string             | `5feff6a3-6768-4817-92d7-5ae3975c6baa` What was the user's comments verbatim?                             |
| `goal`             | non-empty string             | `561e87f4-a1b7-4855-b728-29d19421f7e7` What was the user trying to accomplish?                            |
| `completed`        | `"Yes" \| "No" \| "Unknown"` | `6ebdfabb-3575-49aa-857c-47b6bbfdebc8` Did the user successfully complete the task in your opinion?       |
| `workedWell`       | optional string              | `2316428e-dc3e-4c96-ae67-a6e8c66d7db5` What steps of the interaction with Taskless worked well?           |
| `needsImprovement` | optional string              | `67bedbd9-ca70-4c1c-b1a6-6df830a453dd` What steps of the interaction with Taskless could use improvement? |

`completed` uses PostHog's literal casing so no value mapping exists to drift. The survey id and question map live in one constants module (`src/survey/constants.ts`) and nowhere else. `send` emits `$survey_id` and one `$survey_response_<id>` per answered question, and nothing else survey-specific. Optional questions left blank are omitted rather than sent empty.

Alternative considered: the agent writes `$survey_response_<uuid>` keys directly. Rejected because a mangled UUID is a silently missing answer; a mangled human key is a validation error with a message.

### Survey events are the one exception to the `cli_` prefix

The three names and the `$survey_*` keys are PostHog's contract, and the CLI adds no survey-specific property of its own. They go through the same `capture()` wrapper as every other event, so `cli`, `cliVersion`, `scaffoldVersion`, `ghOwner`, and the adoption dimensions ride along the way they do on everything else, and `cliVersion` is what makes the per-release segmentation work. Which recipe a response belongs to is not on the event; the `cli_agent` event that served the recipe precedes `survey shown` from the same distinct id, and the `goal` answer names the task in the agent's words. The `analytics` delta records the exception so the prefix rule stays enforceable for everything else.

### `feedback-invite.md` is a recipe rendered header-less

The invite text is prose an agent reads, so it belongs under the same Vale rules and the same sprintf substitution (`%(TASKLESS_CLI)s`) as every other recipe. Putting it in `src/agent/` means the cross-reference test requires a `# Topic: feedback-invite` header; the gate renders it with `header: false`, which the renderer already supports and which strips the header block cleanly. It is classified under `INTERNAL_TOPICS`. `agent feedback-invite` will serve it, which is harmless.

Alternative considered: a string literal in `invite.ts`. Rejected because it would be the only recipe prose that escapes the prose linter, and the `.md` rationale in `recipes.ts` explains at length why that matters.

### Invite placement: appended after `See Also`

Pure string append, no parsing of the recipe body. Agents attend to the start and end of a response; the end puts the ask after the task rather than in front of it.

The invite's own content: one exact sentence to put to the user (`Taskless would like to know how the CLI is doing. Would you be okay sharing a few sentences about your experience? Or just skip it with \`skip\`.`), the rule that a reply of `skip`, silence, or something unrelated to feedback is a dismissal (`feedback dismiss`, then carry on with what the user asked), and that any other reply means fetch `agent feedback` and follow it. Ask once; never repeat the question in the same session.

### Migration 0007 adds `/.tmp-*`, and 0001 is not edited

`0007-ignore-scratch-files.ts` calls `addToGitignore(cwd, ["/.tmp-*"])`, anchored with a leading slash for the reason `0001` anchors `/sgconfig.yml`. `addToGitignore` already skips present lines, so the migration is idempotent by construction. A fresh scaffold runs 1 through 7 and ends with the same file as an upgraded one. `feedback send` does not delete the input file; the recipe's clean-up step does, matching `rule create`, and the ignore makes a forgotten file harmless.

## Risks / Trade-offs

- [`survey shown` overcounts] The CLI knows it served the invite, not that the agent surfaced it. The funnel will read shown ≫ sent. → Documented in the analytics delta and the constants module; no property is added to pretend otherwise, since the names are PostHog's.
- [Responses are not tagged with the recipe that invited them] → Accepted; PostHog's survey contract has no slot for it, and the preceding `cli_agent` event plus the `goal` answer recover it when it matters.
- [An agent runs `feedback dismiss` after an unrelated reply that was actually feedback] → The recipe defines dismissal narrowly (`skip`, silence, unrelated); misclassification costs one 20-day gap, not data loss.
- [Scaffold version 7 makes a nightly-scaffolded repo "too new" for a release CLI at 6 until the release ships] → Normal cost of a migration, paid five times already; the migration is the bottom of the stack so it lands first.
- [`feedback` is guessable by name] → Not in the index, and an unprompted `feedback send` still needs a valid payload against a schema the agent has not been shown.
- [Test suites that spawn the built CLI with a real `XDG_CONFIG_HOME`] → The gate is telemetry-first and tests disable telemetry, so no test run writes `next_ask` or emits a survey event. Gate tests stub the environment and point `XDG_CONFIG_HOME` at a temp directory.

## Migration Plan

Forward-merging stack as in the proposal. Rollback of any slice is a revert; slices 1 through 3 have no runtime effect on their own. Reverting slice 4 stops invites; reverting slice 1 after it has run leaves an extra ignore line, which is inert.
