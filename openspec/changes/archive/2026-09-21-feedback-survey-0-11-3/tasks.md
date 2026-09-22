## 1. Survey contract

- [x] 1.1 `src/survey/constants.ts`: `SURVEY_ID` → `01a0c7b9-dfe4-0000-d05e-ce253e90a68c`; `FeedbackKey` and `SURVEY_QUESTIONS` rebuilt for the seven questions in order; docblock records the date and why the ids changed.
- [x] 1.2 `src/schemas/feedback.ts`: `ruleKind` required; `verbatim`, `completed`, `workedWell`, `needsImprovement`, `agents`, `mostValuableRule` optional and non-blank when present.

## 2. Recipes

- [x] 2.1 `agent/feedback.md` → topic v2: `ruleKind` guidance including the onboarding value, `verbatim` optional, no follow-up question, `agents` and `mostValuableRule` guidance, the required/optional sentence under the schema.
- [x] 2.2 `agent/feedback-invite.md` → topic v2: new ask sentence; `skip`/silence/unrelated → `agent feedback` with `verbatim` omitted; explicit refusal → `feedback dismiss`.

## 3. Tests

- [x] 3.1 `feedback-schema.test.ts`: `ruleKind` alone is valid; missing `ruleKind` names the field; blank optional rejected; the smuggled `$survey_response_` key uses a new-survey id.
- [x] 3.2 `feedback-command.test.ts`: the `survey sent` event carries the new `$survey_id` and the new question ids; a payload without `verbatim` sends with no key for question 2.
- [x] 3.3 `feedback-recipes.test.ts`: the new ask sentence; the invite routes `skip` to `agent feedback` and refusal to `feedback dismiss`; the recipe embeds every key of the new schema.
- [x] 3.4 `survey-invite.test.ts` and `survey-cadence.test.ts`: any literal of the old id updated.

## 4. Spec, changeset, archive

- [x] 4.1 Spec delta for `cli-feedback-survey` (MODIFIED blocks restated in full; dry-run the archive and diff scenario counts).
- [x] 4.2 `.changeset/feedback-survey-0-11-3.md`, `patch`.
- [x] 4.3 `pnpm typecheck && pnpm lint && pnpm --filter @taskless/cli test`.
- [x] 4.4 Archive the change on this PR.
