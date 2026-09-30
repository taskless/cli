## 1. Contract

- [x] 1.1 Vendor the v2 schema carrying `GET /cli/api/v2/rule/{ruleId}/revisions` (`pnpm --filter @taskless/cli generate:api`, then prettier on `api-v2.d.ts` by explicit path); verify the `api-v2.schema.json` diff is exactly the one added path
- [x] 1.2 Add `listRevisions` to `api/v2.ts` through `settle`, with a completeness-checked code list and a body guard that answers `unavailable` for anything but `{ ruleId, revisions[], truncated }`; verify with `api-v2.test.ts` cases for 200, 401, 404 `rule_not_found`, and a malformed 200

## 2. Command

- [x] 2.1 Add `schemas/rules-revisions.ts` (`{ success, ruleId, revisions[], truncated }`) beside `rules-recover.ts`, internal like it; verify `pnpm typecheck` passes
- [x] 2.2 Add the listing to `rules/recover.ts`, reusing `failure()` with the pull-request clause dropped from `rule_not_found`; verify with `rule-recovery.test.ts` cases for each spec scenario (current marked by flag not position, truncation note, plan-less listing exits 0, `RULE_NOT_FOUND`)
- [x] 2.3 Add `rule revisions <ruleId> [--json]` to `commands/rules.ts`, sharing identity resolution and error reporting with `runRecovery`; verify human output names `rule rollback`, and `--json` success and error envelopes match the spec

## 3. Guidance

- [x] 3.1 Update `agent/recover-rule.md` to topic v2: a step for choosing a revision with `rule revisions --json`, and `REVISION_NOT_FOUND`'s fix pointing at it instead of the dashboard (hand-edited, no prettier); verify `prompts.test.ts` and `recipe-cross-references.test.ts` pass
- [x] 3.2 Point `REVISION_NOT_FOUND`'s CLI message at `rule revisions <ruleId>`; verify with the existing rollback test
- [x] 3.3 Add a patch changeset for `@taskless/cli` describing the new command

## 4. Verify

- [x] 4.1 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`; all pass
- [ ] 4.2 With a `pnpm build:next` build, run `pnpm cli rule revisions <id>` and `--json` against production for a real issued rule, and `rule rollback` to one of the listed ids; record the result in the PR
- [x] 4.3 Archive the change on this PR (`pnpm openspec archive cli-rule-revisions -y`), after the pre-archive scenario check that every prior `cli-rule-recovery` scenario survives
