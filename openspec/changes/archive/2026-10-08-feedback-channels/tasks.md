## 1. Survey registry and payload schema

- [x] 1.1 Restructure `packages/cli/src/survey/constants.ts` into a `SURVEYS` registry keyed by `rule` / `general` / `bug` (ids and question ids per design.md's table), keep a `RULE_SURVEY_ID` export, and point `survey/invite.ts` and the cadence calls at it; verify `pnpm --filter @taskless/cli typecheck` passes and `survey-invite.test.ts` / `survey-cadence.test.ts` still pass unchanged
- [x] 1.2 Rewrite `packages/cli/src/schemas/feedback.ts` as a `z.discriminatedUnion("kind", …)` of three `z.strictObject` branches, each declaring `kind` as a required `z.literal(…)` with no default, exporting each branch schema; verify with new cases in `feedback-schema.test.ts`: missing `kind` names `kind`, a `general` payload with `ruleKind` names `ruleKind`, a `bug` payload without `expected` names `expected`, each branch's rendered JSON Schema lists `kind` as required with a single `const`, and every existing rule-schema case passes with `kind: "rule"` added
- [x] 1.3 Make `buildSurveyResponse` map through `SURVEYS[input.kind]`; verify a `feedback-command.test.ts` case per kind asserts the `$survey_id` and the exact set of `$survey_response_<id>` keys

## 2. `feedback send` behavior

- [x] 2.1 Add the CLI-built bug version-information answer (CLI version, `install.cliVersion`, `rules.reconciledTo`, platform/arch, Node version; no network, no identity) and attach it to `bug` sends only; verify tests for an initialised project, a directory with no `.taskless/`, and a logged-in token whose login/email/org/repository URL do not appear in the answer
- [x] 2.2 Advance `next_ask` only for `kind: "rule"`; verify a test that sends `general` and `bug` payloads and asserts `next_ask` is unchanged and no cadence file exists for either survey
- [x] 2.3 Change the telemetry-off message for `feedback send` to say telemetry is disabled and name `https://github.com/taskless/cli/issues`, keeping validation first; verify tests under `DO_NOT_TRACK=1` for a valid payload of each kind (exit 0, URL printed, nothing captured) and an invalid one (exit 1, `INVALID_INPUT`)

## 3. Recipes and the agent index

- [x] 3.1 `git mv packages/cli/src/agent/feedback.md packages/cli/src/agent/rule-feedback.md`, update its header/topic name and its payload instructions to include `kind: "rule"`, and repoint `feedback-invite.md` at `agent rule-feedback`; verify `pnpm cli agent rule-feedback` (after `pnpm build`) opens with `# Topic: rule-feedback` and embeds the rule schema
- [x] 3.2 Write the new `packages/cli/src/agent/feedback.md` (general channel: user's words as `verbatim`, agent-drafted `context`, redaction, show-payload-and-wait-for-yes, telemetry-off relay with the issues URL); verify `pnpm cli agent feedback` embeds only the `general` schema
- [x] 3.3 Write `packages/cli/src/agent/bug-report.md` (agent drafts from the session, asks only for gaps, redaction, show-payload-and-wait-for-yes, no version-information ask, telemetry-off relay); verify `pnpm cli agent bug-report` embeds only the `bug` schema and contains no version key
- [x] 3.4 Wire `TOPIC_INPUT_SCHEMAS` in `prompts/recipes.ts` (`rule-feedback` → rule branch, `feedback` → general, `bug-report` → bug) and add `rule-feedback` and `bug-report` to `INTERNAL_TOPICS` in `prompts/index.ts`; verify `prompts.test.ts` and `feedback-recipes.test.ts` pass after updating them for the new topic names
- [x] 3.5 Add a `FEEDBACK_TOPICS` section to the `taskless agent` index in `commands/agent.ts` listing `feedback` and `bug-report`, keep the `feedback` command in `UNLISTED_COMMANDS` with its comment rewritten per design.md; verify a test that the index lists both and does not list `rule-feedback`
- [x] 3.6 Update the `feedback` command's `meta.description` and the comment above `feedbackCommand` to describe three channels; verify `pnpm cli feedback --help` reads correctly
- [x] 3.7 Run Vale over the three recipes and fix findings; verify `pnpm lint` reports no recipe prose errors

## 4. Skill, spec purpose, and changeset

- [x] 4.1 Add "send feedback to Taskless" and "report a Taskless bug" triggers to the `description` in `skills/taskless/SKILL.md` and two rows to its Topics table (`agent feedback`, `agent bug-report`); verify any skill parity/render test passes
- [x] 4.2 Update the `## Purpose` of `openspec/specs/cli-feedback-survey/spec.md` to cover all three channels; verify `pnpm openspec validate feedback-channels --strict` passes
- [x] 4.3 Add one `patch` changeset describing the general and bug-report channels, the `rule-feedback` rename, and the required `kind`; verify `.changeset/` contains exactly one new file

## 5. Verification

- [x] 5.1 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`; all pass
- [x] 5.2 Run the pre-archive scenario check from CLAUDE.md (commit, `pnpm openspec archive feedback-channels -y`, confirm every prior `#### Scenario` under the invite and cadence requirements is still present plus the new ones, reset to the saved SHA)
- [x] 5.3 Confirm each kind reaches PostHog with the right questions answered: satisfied without a live send. Every survey and question id was transcribed from the live survey definitions (read 2026-10-08), the rule survey's content is reused unchanged, and `survey-cadence.test.ts` and `feedback-command.test.ts` pin each kind's `$survey_id` and `$survey_response_<id>` keys
