## 1. Resolve the entitlement

- [x] 1.1 Replace `resolveOrgSubject` with `resolveActingOrg` in `auth/org.ts`, returning `{ subject, restoreRules? }` from the one whoami call; `restoreRules` only when an organization matched and its `entitlements.restoreRules` is a boolean; verify with `org.test.ts` cases for `true`, `false`, absent `entitlements`, whoami failure, and no matching organization
- [x] 1.2 Add `restoreRules?: boolean` to `Identity` and set it in `resolveIdentity`; verify `pnpm typecheck` passes and whoami is still called once per resolution

## 2. Suggestions in check

- [x] 2.1 Replace `applyVerdicts`' `restoreCommand` with a `recovery({ ruleId, engine?, purpose })` sentence callback, and add the pure renderer for the restore and git variants (engine-less `missing` uses the quoted any-engine pathspec); verify every existing `verdicts.test.ts` case passes unchanged with `restoreRules` unknown
- [x] 2.2 Pass the tri-state from `resolveActingOrg` into the callback in `plan-check.ts`; verify with `verdicts.test.ts` cases for `unsafe` (runtime and static), `missing` (with and without engine), and a rename, each under `false` giving git steps and not naming `rule restore`

## 3. Suggestions in rule revisions

- [x] 3.1 Give `describeRevisions` an optional `restoreRules` and pass `identity.restoreRules` from `commands/rules.ts`; verify with `rule-recovery.test.ts` that `false` keeps the listing and replaces only the closing line, and unknown names `rule rollback`
- [x] 3.2 Confirm `rule restore` / `rule rollback` still call the service under `restoreRules: false`; verify with a `rule-recovery.test.ts` case that relays the refusal

## 4. Guidance

- [x] 4.1 Update `agent/check.md` (v5) and `agent/recover-rule.md` (v3) as design.md describes, hand-edited, no prettier; verify `prompts.test.ts` and `recipe-cross-references.test.ts` pass
- [x] 4.2 Add a patch changeset for `@taskless/cli` on unit 2, extended on unit 3; verify it is `patch` (pre-1.0)

## 5. Verify

- [x] 5.1 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`; all pass
- [ ] 5.2 Pre-archive scenario check for all three capabilities, then archive the change on this PR (`pnpm openspec archive cli-plan-aware-recovery -y`)
