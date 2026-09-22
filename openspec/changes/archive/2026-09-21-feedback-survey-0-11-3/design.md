## Context

The first survey (`01a0b1a0-…`) required `verbatim`, `goal`, and `completed`. Measured against PostHog's definition on 2026-09-21: Q1 and Q3 carried no `optional` field (PostHog's default is required), Q2 was `optional: false`, Q4 and Q5 `optional: true`. The CLI's Zod schema matched that. The consequence in practice: a user who replied `skip` produced a `survey dismissed` and nothing else, even though the agent had four answers ready that needed no one's permission.

The replacement (`01a0c7b9-…`, "Product-market fit (PMF) (0.11.3)", started 2026-09-22) has seven questions. Only Q1 is required.

| #   | id                                     | question                                                                                                                    | optional |
| --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | `0874591f-c554-4ac3-8930-e11c436d859e` | What kind of rule was the user trying to create?                                                                            | no       |
| 2   | `2c3c80dc-dcda-4e29-b52e-a25ef58b5ca2` | Did the user offer any comments? (leave blank if no comments)                                                               | yes      |
| 3   | `605e12a8-82b6-480f-93b2-ab8de0fa08bd` | Did the user successfully complete the task in your opinion? (`Yes`/`No`/`Unknown`)                                         | yes      |
| 4   | `b5375d87-e295-4833-84ed-fca8140ba992` | What steps of the interaction with the Taskless skills & CLI worked well?                                                   | yes      |
| 5   | `a8cf706d-3ff7-4845-bea9-501013be958c` | What steps of the interaction with Taskless skills & CLI could use improvement?                                             | yes      |
| 6   | `f85b22df-8e51-4c9c-8219-261b33b71c90` | What agent(s) or framework(s) is the user using that are open sourced and publicly available?                               | yes      |
| 7   | `4f8e938e-22f6-449c-9b8c-43c51d08e214` | Of the rules created so far, what rule is creating the most value for the team and why? (leave blank if there are no rules) | yes      |

Required-ness is enforced by PostHog's popover UI only; the capture API accepts a `survey sent` with any subset of `$survey_response_*` keys. The CLI's schema is therefore the only gate, and it mirrors PostHog's definition so that the responses view and the CLI agree on what a complete answer is.

## Decisions

### Human keys

| key                | question | required |
| ------------------ | -------- | -------- |
| `ruleKind`         | 1        | yes      |
| `verbatim`         | 2        | no       |
| `completed`        | 3        | no       |
| `workedWell`       | 4        | no       |
| `needsImprovement` | 5        | no       |
| `agents`           | 6        | no       |
| `mostValuableRule` | 7        | no       |

`ruleKind` rather than `goal`: the question narrowed from "what were they trying to accomplish" to "what kind of rule", and the old key would invite the old answer. `agents` is plural because the question is. `mostValuableRule` is the question's noun phrase.

The map stays the only place ids live, and `buildSurveyResponse` stays a loop over it, so the command does not change.

### `ruleKind` on the onboarding path

`onboard` is surveyed and creates no rule. The recipe tells the agent to answer `none (onboarding)` there, and otherwise to name the engine and what the rule was for in a phrase (`ast-grep, forbid eval in TypeScript`). The value is free text on PostHog's side; the recipe supplies the shape, the schema only requires non-empty.

### `skip` sends; an explicit refusal dismisses

Six of the seven answers are the agent's own account of the session. That is the same category of data as `cli_rule_create` or `cli_check`: telemetry the user opted into by leaving it enabled, and the gate already withholds the invite under `DO_NOT_TRACK`. The only answer that is the user's is the quote, so the invite asks for exactly that and offers exactly two replies:

> Taskless would like to know how this went. Anything you'd like to add in your own words? Reply `skip` if not, and I'll send my own notes on the session.

- words → `verbatim` is those words, unedited, and the agent sends;
- `skip`, silence, or an unrelated reply → `verbatim` is omitted and the agent sends the rest.

There is no third option in the invite, so no reply the invite solicits produces nothing. `feedback dismiss` is kept for the reply it does not solicit: a user who says not to send anything ("no", "don't send that") is asking for the response not to exist, and the CLI honours that and records it as a dismissal. The recipe tells the agent, in that case, to say in one line that the rest of the CLI's telemetry is governed by `DO_NOT_TRACK=1` / `TASKLESS_TELEMETRY_DISABLED=1`, so the user learns where the real switch is rather than being offered a per-survey one that covers one capture in twenty.

### No follow-up question

The old recipe permitted one follow-up, to fill `completed` when the reply left it unclear. `completed` is optional now, and `Unknown` exists for exactly that state, so the follow-up goes. The invite is the only question the flow puts to the user.

### Filling `agents` and `mostValuableRule`

`agents`: the agent names the harness it is running in and any framework it can see the project using, restricted to open-source, publicly available software as the question asks. It omits the key rather than naming an internal or proprietary tool. No PII is involved; this is the name of a product.

`mostValuableRule`: the agent answers from the session and from `.taskless/rules/` when it has a view; it omits the key when it does not, and does not ask the user. The question is aimed at a team that has lived with its rules for a while, and most surveyed sessions are the one that just wrote the first one.

### Cadence

Unchanged. The store is keyed by survey id, so the new id gets a fresh `next_ask` and every install is invited once more on its next surveyed recipe. That is the intended effect of shipping a new survey and the standing spec already states it.

## Alternatives considered

- **Offer `no` in the invite alongside `skip`.** Rejected: it invites a reply that produces nothing from a user who has telemetry enabled, and the agent's six answers are not the user's to withhold any more than the other events are. The refusal path exists for the user who volunteers it, not as a menu item.
- **Remove `feedback dismiss`.** Rejected: an explicit "don't send anything" needs a verb that honours it and records it, and the verb already exists.
- **Keep `goal` as the key and change only its description.** Rejected: the key would be read by an agent that learned the old recipe, and the old answer is not the new question.
- **Send on silence without asking at all.** Rejected: the user's words are the answer the survey exists to collect, and an ask that costs one line is worth it.
