## 1. Slice 1: migration 0007 ignores scratch files (bottom of the stack)

- [ ] 1.1 Add `packages/cli/src/filesystem/migrations/0007-ignore-scratch-files.ts` calling `addToGitignore(cwd, ["/.tmp-*"])`, with a header comment saying why `0001` is not edited; register it as `"7"` in `migrate.ts`. Verify `git diff` touches no file under `migrations/` other than the new one.
- [ ] 1.2 Add tests: a version-6 scaffold gains `/.tmp-*` and records 7; a fresh scaffold ends with `.env.local.json`, `/sgconfig.yml`, `/.tmp-*`; running 7 twice leaves one line. Verify with `pnpm --filter @taskless/cli test -- migrate`.
- [ ] 1.3 Fix any test that pins the max scaffold version or the exact `.gitignore` contents (`check-gitignore.test.ts`, `migrate-*.test.ts`, `install-state.test.ts`). Verify `pnpm --filter @taskless/cli test` passes.
- [ ] 1.4 Add the single changeset (`patch`, `@taskless/cli`) describing the ignore line, with a body that says the scaffold's own `version` field carries the compatibility signal. Verify `.changeset/*.md` exists and `pnpm changeset status` lists it.
- [ ] 1.5 Run `pnpm typecheck` and `pnpm lint`; open PR 1 against `main`.

## 2. Slice 2: survey constants, cadence store, and the `feedback` subcommand

- [ ] 2.1 Add `packages/cli/src/survey/constants.ts` with the survey id, the five `{ key, id, question }` entries (Q3 id `6ebdfabb-3575-49aa-857c-47b6bbfdebc8`), the surveyed-topic list (used only by the gate), and the 10-day / 20-day intervals. Verify a test asserts the five question ids against the values in design.md.
- [ ] 2.2 Add `packages/cli/src/survey/cadence.ts`: read `next_ask` (missing or unparseable → `undefined`), write `next_ask` under `getConfigDirectory()/surveys/<survey id>/`. Verify tests with `XDG_CONFIG_HOME` pointed at a temp directory cover absent, valid, corrupt, and that a different survey id reads its own file.
- [ ] 2.3 Add `packages/cli/src/schemas/feedback.ts` (Zod: `verbatim`, `goal`, `completed` as `"Yes" | "No" | "Unknown"`, optional `workedWell` / `needsImprovement`). Verify tests reject `completed: "partially"` and a missing `verbatim`, each naming the field.
- [ ] 2.4 Export the telemetry "enabled" predicate from `telemetry.ts` rather than duplicating it, and a `TelemetryClient`-typed way for a command to know it holds the no-op client. Verify `telemetry.test.ts` still passes.
- [ ] 2.5 Add `packages/cli/src/commands/feedback.ts` with `dismiss` and `send --from`; `send` maps keys to `$survey_response_<id>`, adds `$survey_id`, and omits blank optionals; both advance `next_ask` by 20 days and print a one-line "nothing sent" under disabled telemetry with exit 0. Verify tests spawn the built CLI with telemetry stubbed and assert the captured payload shape, the `INVALID_INPUT` path, the input file surviving, and no `.taskless/` bootstrap.
- [ ] 2.6 Add `feedback` to `SUBCOMMAND_NAMES`, register it in `index.ts`, add it to `UNLISTED_COMMANDS` in `agent.ts`. Verify `pnpm typecheck` passes and `taskless agent` output does not list `feedback`.
- [ ] 2.7 Extend the changeset on the bottom branch with the new verbs. Run `pnpm typecheck` and `pnpm lint`; open PR 2 against PR 1's branch.

## 3. Slice 3: the `feedback` and `feedback-invite` recipes

- [ ] 3.1 Write `packages/cli/src/agent/feedback.md` (`# Topic: feedback … topic v1`): the agent is the respondent, one verbatim answer from the user, the rest from observation, `%(INPUT_SCHEMA)s`, write `.taskless/.tmp-feedback.json`, run `%(TASKLESS_CLI)s feedback send --from …`, clean up. Register `feedback` in `TOPIC_INPUT_SCHEMAS`. Verify `pnpm build && pnpm cli agent feedback` prints the header and the JSON Schema.
- [ ] 3.2 Write `packages/cli/src/agent/feedback-invite.md` (`# Topic: feedback-invite … topic v1`) with the exact ask sentence from design.md, the dismissal rule (`skip`, silence, unrelated → `%(TASKLESS_CLI)s feedback dismiss`), the feedback path (`%(TASKLESS_CLI)s agent feedback`), and ask-once. Verify `pnpm cli agent feedback-invite` renders with no unsubstituted marker.
- [ ] 3.3 Add both topics to `INTERNAL_TOPICS`. Verify `recipe-cross-references.test.ts`, the topic-membership test, and `pnpm cli check` (Vale over the new prose) all pass.
- [ ] 3.4 Extend the changeset. Run `pnpm typecheck` and `pnpm lint`; open PR 3 against PR 2's branch.

## 4. Slice 4: the gate and injection (tip of the stack)

- [ ] 4.1 Add `packages/cli/src/survey/invite.ts`: `withSurveyInvite({ recipe, topic, invocation, cwd })` evaluates the gate (telemetry enabled, `CI` not `"true"`/`"1"`, topic surveyed, `next_ask` passed), and when open captures `survey shown` with `$survey_id`, writes `next_ask` + 10 days, and returns recipe + rendered `feedback-invite` (`header: false`). Verify unit tests cover every gate branch in the spec, including the corrupt-file repair.
- [ ] 4.2 Call it from `agent.ts` (after a successful `getRecipe`) and from `onboard.ts` (recipe-serving path only; not `--mark-complete`, not the already-onboarded early return). Verify a test with telemetry stubbed on and `XDG_CONFIG_HOME` in a temp directory shows the invite on `agent create-sg-rule`, `agent onboard`, and `onboard`, and not on `agent check`.
- [ ] 4.3 Confirm the untouched paths: `prompts.test.ts` byte-parity passes as-is, and `getPrompt()` output contains no invite under any option. Verify `pnpm --filter @taskless/cli test` is green.
- [ ] 4.4 Add a comment in `survey/constants.ts` recording that `survey shown` means "served", not "surfaced", and that the funnel reads shown ≫ sent by design.
- [ ] 4.5 Extend the changeset with the invite. Run `pnpm typecheck` and `pnpm lint`; open PR 4 against PR 3's branch.
- [ ] 4.6 After the invite is verified end to end against the real survey (one `survey sent` visible in PostHog under the survey's responses with labelled columns), archive the change on this tip: `pnpm openspec archive qualitative-survey-feedback -y`, checking every prior scenario in the three modified specs survives per the pre-archive procedure in CLAUDE.md.
