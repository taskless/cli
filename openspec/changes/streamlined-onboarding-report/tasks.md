## 1. Detect: ast-grep, Vale, glab, and agent hints (PR 1, bottom of the stack)

- [x] 1.1 Add the `.changeset/streamlined-onboarding-report.md` (`patch`) on this branch before cutting any child branch; it is grown by each later group. Verify `git diff --stat origin/main` shows it.
- [x] 1.2 Add `ast-grep` (`sgconfig.yml`, `.sgconfig.yml`) and `vale` (`.vale.ini`, `_vale.ini`) to the linter signals in `detect/scan.ts`, pruning `.taskless/` from their evidence. Verify with detect tests: a root `sgconfig.yml` reports `ast-grep`, a `.taskless/sgconfig.yml` alone reports nothing, and the same for Vale.
- [x] 1.3 Replace the per-tool logic in `host-tools.ts` with one table (name, applicability predicate, inapplicable reason, hint command, hint text) and add `glab`, applicable when `origin` is `gitlab.com` or a `gitlab.*` host. Verify unit tests cover `gh`/`glab` × GitHub/GitLab/no origin, and that nothing is executed.
- [x] 1.4 Add `hostTools` and `agent` to the detect output schema and `detect --json`; `agent` holds hints only for present and applicable tools, and the `glab` hint says to read the output, not the exit code. Verify a detect JSON test asserts both fields and the schema validation passes.
- [x] 1.5 Feed the onboard recipe's host-tool list from the same catalog, so `glab` and every inapplicable reason come from one row. The review-comment source for `glab` waits for v6 (4.1): rendering merge requests into v5 would contradict the live `cli-onboard` scenario for repositories with no GitHub origin. Verify the existing `onboard`/`agent onboard` byte-parity tests pass.
- [x] 1.6 Run `pnpm typecheck` and `pnpm lint`; both pass.

## 2. Rename rules/report → rules/check-summary (PR 2)

- [x] 2.1 `git mv packages/cli/src/rules/report.ts packages/cli/src/rules/check-summary.ts` and update importers (`plan-check.ts`, `recover.ts`, `verdicts.ts`, `test/verdicts.test.ts`, `test/check-snapshot.test.ts`). Verify `grep -rn "rules/report" packages/cli` is empty and `pnpm --filter @taskless/cli test` passes.
- [x] 2.2 Run `pnpm typecheck` and `pnpm lint`; both pass.

## 3. taskless report (PR 3)

- [ ] 3.1 Add `scripts/fetch-report-schema.ts` and a `generate:report` script vendoring `src/generated/report-v1.schema.json` in the style of `fetch-api-schema.ts`. Validate with `z.fromJSONSchema()` over the vendored document (D6). Verify with a test that validates the schema's `examples[0]` and rejects each counter-example.
- [ ] 3.2 Add migration `0011` creating `.taskless/reports/` with its stub and adding `/reports/` to `.taskless/.gitignore`. Verify migration tests: upgrade from version 10, fresh scaffold, and idempotence with existing records.
- [ ] 3.3 Build the draft: producer, scope from the `origin` remote, one entry per rule directory with tier, engine, language, test status and first fail/pass fixture, default projection inputs, and `missing[]`. Verify `taskless report` against fixture repositories (sg+vale rules; GitHub origin; no origin) with a snapshot test, and that it makes no network call.
- [ ] 3.4 Define the facts zod schema (history, window, rule facts, `legacy[]`, `cloud[]`, estimates, agent redaction counts, withheld fixtures) and the merge in which CLI-established fields win. Verify tests for an engine conflict, an unknown `perMonth` key refused as `REPORT_INVALID`, and cloud candidates published as `cloud`/`runtime`/`not-run`.
- [ ] 3.5 Implement the projection (D3) and the gate. Verify tests: the 90-day/30-fixes → 10 normalization, two local rules → `REPORT_INSUFFICIENT` naming 2 of 3, one `sg` plus two agent-written `legacy` rules passing, a near-zero projection not refusing, and a failing rule not counted.
- [ ] 3.6 Implement redaction (D5): the five pattern classes, withholding a whole fixture on a hit or when over length, `REPORT_REDACTION` for an agent-supplied string, summed counts, and `policyVersion`. Verify tests per class and that no withheld fixture byte appears in the payload.
- [ ] 3.7 Validate against the vendored schema and the 262,144-byte cap before sending. Verify tests that an invalid or oversized payload exits non-zero and that the stubbed client is never called.
- [ ] 3.8 Implement the publish client (D7): private retention, a 502 retried at most twice, no retry on timeout (`REPORT_PUBLISH_UNKNOWN`), 429 → `REPORT_RATE_LIMITED`, 400 → `REPORT_INVALID` with the service's details, base URL overridable for tests. Verify each path against a local test server.
- [ ] 3.9 On 201, write `.taskless/reports/<UTC stamp>.json` with `{ url, deleteUrl, expiresAt }` and print the templated summary (rule title and tier per line, headline projection, URL, expiry, the deletable-after-review sentence); `--json` prints URL, expiry, record path, and summary. Verify tests that exactly one record is written and that the delete credential appears on stdout in neither form.
- [ ] 3.10 Implement `taskless report delete <record>` as an HTTP `DELETE` to the recorded `deleteUrl`: remove the record on success, keep it on failure, `REPORT_NOT_FOUND` for a missing record. Verify against the local test server.
- [ ] 3.11 Emit `cli_report_drafted`, `cli_report_published` (per-tier counts and gate outcome), `cli_report_refused` (code), and `cli_report_deleted`. Verify a telemetry test that no event carries a URL, credential, title, or fixture.
- [ ] 3.12 Write `agent/report.md` (check, supply what `missing` names, estimate from session habits, generate, handle `REPORT_INSUFFICIENT` with questions only about the rules it lacks, show the summary, mention deletion, delete the facts file, delete on request), embedding the facts JSON Schema. Register the topic in the agent index and classify it in the prompts topic list. Verify `taskless agent report` opens with `# Topic: report`, contains the schema, and the topic-membership and "recipes name only commands that exist" checks pass.
- [ ] 3.13 Extend the changeset with the `report` command. Run `pnpm typecheck` and `pnpm lint`; both pass.

## 4. Onboard v6, skill, and feedback (PR 4)

- [ ] 4.1 Rewrite `agent/onboard.md` as topic v6 per the `cli-onboard` spec: the one question, logged out, mine everything, author local candidates without asking, record runtime candidates for the `cloud` tier, `--mark-complete` without asking, hand off to `report` and `rule-feedback` in parallel, close by showing the summary and then, last, offering CI integration via the `ci` topic with a strong case for it (checks keep agents from reintroducing what the rules catch), naming `hooks` in one line on a no. Verify recipe tests for each scenario in the spec delta, and the two-path byte-parity tests. Render the review-comment source from the host-tool catalog for both `gh` (pull requests) and `glab` (merge requests).
- [ ] 4.2 Remove `onboard` from the surveyed topics in `survey/constants.ts`. Verify a survey test that onboarding serves no invite and leaves `next_ask` unchanged with the gate otherwise open.
- [ ] 4.3 Add the "reached from onboarding" branch to `agent/rule-feedback.md`: no `verbatim`, `ruleKind: none (onboarding)`, no question, send. Verify the recipe test and that `feedback send` still refuses under `DO_NOT_TRACK=1`.
- [ ] 4.4 Add the `report` row to the skill body and the `tskl` command body via `%(TASKLESS_CLI)s`. Verify the skill tests, including the 80-line cap.
- [ ] 4.5 Update `getOnboardTrailer` and the `onboard` command description if their wording still promises a conversational discovery flow. Verify the init trailer tests.
- [ ] 4.6 End to end: `pnpm build`, then in a scratch repository with a GitHub origin follow `pnpm cli onboard` as an agent would, through `report --from` against the local test server, and confirm the record, the summary, and `install.onboarded: true`.
- [ ] 4.7 Extend the changeset with the onboarding change. Run `pnpm typecheck` and `pnpm lint`; both pass.

## 5. Archive (PR 5, tip of the stack)

- [ ] 5.1 Run the pre-archive check from CLAUDE.md (commit, keep the SHA, `pnpm openspec archive streamlined-onboarding-report -y`, confirm every prior scenario of `cli-detect`, `cli-feedback-survey`, and `cli-taskless-bootstrap` survives, then reset to the SHA).
- [ ] 5.2 Archive for real, then update `openspec/specs/cli-onboard/spec.md`'s Purpose, which still describes a conversational flow. Verify `pnpm openspec validate --strict` passes on the result.
