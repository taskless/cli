## Context

The survey machinery assumes one survey throughout: `survey/constants.ts` exports a single `SURVEY_ID` and `SURVEY_QUESTIONS`, `buildSurveyResponse` maps one flat payload, and both `feedback` verbs advance one cadence file. The invite (`survey/invite.ts`) and its gate are already per-survey in shape (the cadence store is keyed by survey id), so they need no change beyond the topic name the invite text points at.

The three PostHog surveys are fixed inputs (verified 2026-10-08, all active):

| kind      | survey id                              | questions (id → payload key)                                                                                                                                             |
| --------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rule`    | `01a0c7b9-dfe4-0000-d05e-ce253e90a68c` | unchanged from today's seven                                                                                                                                             |
| `general` | `01a11da4-3948-0000-4ae4-c9da9321801e` | `c71e52ee…` Feedback → `verbatim`; `ab0ceb25…` Attach any additional context → `context`                                                                                 |
| `bug`     | `01a11da7-27a2-0000-0f4e-6d3e1f89f385` | `2dd63cf3…` → `summary`; `ba096b81…` Version Information → CLI-filled; `e59a87e9…` → `trying`; `73415b80…` → `expected`; `daa98d8d…` → `actual`; `597381f5…` → `context` |

Full question ids live in `constants.ts` only, as they do today.

## Goals / Non-Goals

**Goals:**

- One send path, three surveys, with the payload's shape checked before anything leaves the machine.
- The agent never handles a question UUID or a survey id.
- User-initiated channels never disturb the invite cadence.

**Non-Goals:**

- A cadence, invite, or `dismiss` for the general or bug channels. They exist because the user asked; there is nothing to throttle.
- Stripping identity from bug reports. The existing telemetry identity (anonymous id, or JWT subject when logged in, plus `ghOwner` and adoption dimensions) rides along as on every event. "Anonymous" here means no GitHub account is required.
- Attachments, logs, or file uploads in a bug report.
- Any PostHog survey change.

## Decisions

**A survey registry keyed by kind.** `constants.ts` exports `SURVEYS: Record<FeedbackKind, { id, questions }>`, where each question is `{ key, id, question }` as today. `buildSurveyResponse(input)` looks up `SURVEYS[input.kind]` and walks its questions. `RULE_SURVEY_ID` is kept as a named export because the invite, the gate, and `dismiss` refer to that survey specifically, and spelling it `SURVEYS.rule.id` at each site hides that they are survey-specific. Alternative: three parallel modules. Rejected: the mapping loop is identical, and three copies is the DRY threshold.

**One `feedback send`, a zod discriminated union on `kind`.** `inputSchema = z.discriminatedUnion("kind", [rule, general, bug])`, each branch a `z.strictObject`. Strict, so a `general` payload carrying `ruleKind` fails naming the key instead of the key being silently dropped. That also tightens the `rule` branch, which today strips unknown keys; the recipe that writes it ships in the same binary, so the only payloads affected are hand-written ones. Each recipe embeds its own branch (`rule-feedback` → `ruleSchema`, etc.) through `TOPIC_INPUT_SCHEMAS`, so an agent reading `bug-report` never sees the rule keys. Alternatives: a `--kind` flag (duplicates what the file must say anyway, and lets the two disagree), or three verbs (three copies of read/parse/validate/error handling).

**`kind` is required: it is the zod discriminator.** Each branch declares `kind` as a required literal (`z.literal("rule")`, `z.literal("general")`, `z.literal("bug")`), with no `.default()` and no preprocessing that fills it in. That is what makes it the discriminator, and it carries through to the recipes: each branch's rendered JSON Schema lists `kind` under `required` with a single `const` value, so the agent reading a recipe sees the exact literal to write. A missing or unknown `kind` fails as "`kind` …", rather than being read as `rule` and failing as "`ruleKind` is required", which would point the agent at the wrong recipe.

**The CLI writes the bug survey's version-information answer.** It is assembled in the command from `__VERSION__`, the manifest read (`install.cliVersion`, `rules.reconciledTo`), `process.platform`/`process.arch`, and `process.version`, rendered as a few `key: value` lines. It reuses `readManifest` and does not call `info`'s handler: `info` makes a network `whoami` call and reports identity, both of which this answer must not carry. The agent's schema has no key for it, so it cannot be wrong or omitted.

**The index gains a "Feedback recipes" section listing `feedback` and `bug-report`; `rule-feedback` stays unlisted.** The index prints CLI commands (every subcommand not in `UNLISTED_COMMANDS`) and then the explicit `RECIPE_TOPICS` list under "Authoring recipes". Neither new topic is an authoring recipe, and `bug-report` is not a command, so a third explicit list, `FEEDBACK_TOPICS`, prints under its own heading and joins the shared padding width. The `feedback` _command_ stays in `UNLISTED_COMMANDS`: what the agent should reach is the recipe, which tells it to get consent before running the command, and listing both would offer a path that skips the recipe. Its comment there is rewritten to say so. `rule-feedback` appears in no list, which is all it takes to keep it out: listed, an agent runs it unprompted and the funnel fills with uninvited `survey sent`. Alternative: append both to `RECIPE_TOPICS`. Rejected because "Authoring recipes" would then mislabel them.

**Telemetry off: validate, then redirect.** The order stays validate-first, so an agent still hears about a malformed payload. The message changes from "Nothing else to do" to naming `https://github.com/taskless/cli/issues`, for every kind, because the user is now often the one who asked to send. `dismiss` keeps its current line: a dismissal under the opt-out has nothing to redirect.

**Consent lives in the recipes, not the CLI.** The general and bug recipes require the agent to show the payload and get an explicit yes. A CLI-side `--yes` flag was considered and rejected: the agent would pass it reflexively, and the CLI cannot tell a human's yes from the agent's.

**Recipe file moves.** `agent/feedback.md` → `agent/rule-feedback.md` (git mv, so its history follows), then a new `agent/feedback.md`. `feedback-invite.md`'s two references change to `agent rule-feedback`. All three new and renamed topics join `INTERNAL_TOPICS` in `prompts/index.ts`: none has a reader outside the CLI that sends the response.

## Risks / Trade-offs

- [An agent mixes CLI versions: the invite comes from one CLI and `agent feedback` (now the general recipe) from an older or newer one.] → The invite and the recipe it names are served by the same binary in every documented flow (the skill pins one version). A mismatched agent following an old invite to the new `agent feedback` gets the general recipe, whose payload still validates and reaches a real survey: misfiled, not lost.
- [Free-text answers carry secrets or proprietary code to PostHog.] → Both recipes require redaction and a user-approved preview. The CLI does not try to detect secrets; a heuristic scanner would give false confidence.
- [The general and bug PostHog surveys carry the PMF description text.] → Cosmetic and not respondent-visible; noted to the survey owner, not fixed here.
- [Strict objects reject a key a future survey question adds before the CLI knows it.] → That is the intended failure: the CLI owns the map, and an unmapped key would otherwise be dropped silently.

## Migration Plan

No data migration. The rule survey id is unchanged, so every install's cadence carries over. Rollback is a revert; no state is written that an older CLI cannot read.
