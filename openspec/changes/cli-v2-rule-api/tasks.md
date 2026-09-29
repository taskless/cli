Groups map to the stack in proposal.md's delivery shape: 1–2 are slice 1
(contract), 3 is slice 2 (generation), 4–6 are slice 3 (reconcile), 7 is slice
4 (recovery), 8–9 are slice 5 (retire v1, verify, archive). Each slice is its own
branch targeting the one below; the stack merges down.

## 1. Contract and changeset (slice 1)

- [x] 1.1 Dry-run the archive (done on a scratch copy of `openspec/`, which
      needs no WIP commit) and confirm every standing scenario title in
      `cli-check`, `cli-rule-reconciliation`, `cli-generated-rule-delivery`,
      `cli-rules`, and `cli-runtime-rule-execution` survives, and that only the
      requirements listed under REMOVED disappear. `pnpm openspec validate
cli-v2-rule-api --strict` passes.
- [x] 1.2 Add the `minor` changeset on this branch. The body says: the CLI now
      speaks only the v2 API and 0.11.x stops working once 0.12.0 is the
      server's floor; `check` fails on an edited sg or vale rule; `rule create
--json` prints `requestId` instead of `ruleId`; `rule restore` and `rule
rollback` exist. Verify `pnpm changeset status` proposes `0.12.0`.
- [x] 1.3 Confirm the nightly stamp: run `node .github/scripts/nightly-pack.cjs
--print-version --status <changeset status output> --sha <sha>` on this branch and check it prints `0.12.0-*`, since the
      server resolves a prerelease to the release it precedes.

## 2. v2 schema and client (slice 1)

- [x] 2.1 Point `scripts/fetch-api-schema.ts` at `/cli/api/v2/__schema`,
      writing `api-v2.schema.json` / `api-v2.d.ts` beside the frozen v1 files
      (design Decision 1), run `pnpm --filter @taskless/cli generate:api`, and
      review the new document. Verify every v2 operation (whoami, reconcile,
      request, request status, rule fetch, iterate, restore, rollback,
      rule-hash-vectors) is present with its documented error responses.
- [x] 2.2 Point `scripts/fetch-rule-hash-vectors.ts` at
      `/cli/api/v2/rule-hash-vectors`; the committed fixture is unchanged
      (measured identical to v1) and `rule-hash.test.ts` passes.
- [x] 2.3 Add `api/v2.ts`: one typed `openapi-fetch` client over the v2 `paths`,
      always sending `x-taskless-cli-version`, with one function per operation
      returning an outcome union (`ok` / `refused` / typed error codes /
      `unauthorized` / `unavailable`) and never throwing for expected
      conditions. Unit tests cover each operation's success, each documented
      error code, a network failure, and an unparseable body.
- [x] 2.4 Add `api/refusal.ts`: parse `{ restoreRules: false, reason, message,
upgradeUrl }`, strip C0/C1 control characters except newline from
      `message`, keep `upgradeUrl` only as absolute `https:`. Tests cover an
      unknown `reason`, an ANSI escape in `message`, and a relative URL.
- [x] 2.5 Add `parseEntitlementV2` beside the v1 parser in
      `api/entitlement.ts` (v1 is deleted in 8.1 with its last caller):
      `withheld` is `{ ruleId, revisionId }[]`, matched by `ruleId`; no entry is
      dropped for lacking `file`. Tests include the #403 hazard: a v2 withheld list parses
      to the same number of entries it arrived with.

## 3. Generation on v2 (slice 2)

- [x] 3.1 Add `rules/verify-delivery.ts`: verify a served file set against its
      `signatures` (every signature names a file, every non-`.tests/` file has
      one, each hash matches, runtime `signature` equals the `check.ts` entry)
      and that `rules` holds exactly one set whose `id` is the requested id.
      Unit tests for each refusal.
- [x] 3.2 Make `writeDeliveredFileSet` the only write path for a served rule
      (`writeServedRule`) and make it replace the directory (purge files the
      set lacks, `.tests/` included; create each file's parent directories).
      `deliver.test.ts` covers a stale fixture and a local extra capture being
      removed. The legacy single-`content` branch still has a caller in the v1
      repair path until 5.3, so it is dropped in 8.1.
- [x] 3.3 Move `rule create` to v2: submit, poll, fetch each produced
      `{ ruleId, revisionId }` head in parallel without `revision`, confirm
      `revisionId`, verify, write. Print `error` verbatim (sanitized) on
      `failed` / `unsupported`. `--json` prints `requestId` and `rules`, no
      `ruleId`; update `schemas/rules-create.ts`. Tests use a stubbed v2 server.
- [x] 3.4 Move `rule improve` to `POST v2/rule/{ruleId}/iterate`, with the input
      `ruleId` meaning the directory name; `404 rule_not_found` →
      `RULE_NOT_FOUND`. Tests cover success and the not-found code.
- [x] 3.5 Keep the write-time entitlement warning for runtime sets served with
      `runtimeSignatures: false`; `rule-create-entitlement.test.ts` passes
      against v2 fixtures.
- [x] 3.6 Update the `create-remote-rule`, `improve-rule`, and `rule-meta`
      recipes: record the rule ids from `rules`, pass a directory name to
      `improve`, never the request id. `recipe-cross-references.test.ts` passes.

## 4. Snapshot (slice 3)

- [x] 4.1 Measure first: the mixed-engine fixture plus a Vale rule scoped to
      `[docs/**/*.md]`, run with configs assembled at `.taskless/` and in the
      mirrored snapshot, gives identical findings (7 across 5 rules) and the
      same subdirectory scoping. Design Decision 2 records the layout.
- [x] 4.2 Add `rules/snapshot.ts`: replace `.taskless/.run/snapshot/` with a
      dereferencing copy of `.taskless/rules/`, skipping `.DS_Store`,
      `Thumbs.db`, `desktop.ini`; a dangling link drops the file. Tests cover a
      symlinked capture, a dangling link, and an OS metadata file.
- [x] 4.3 Run `check`'s assembly against the snapshot base, so its configs land
      inside the snapshot while `verify` / `test` keep today's paths. A test
      pins identical findings from both locations, including a
      subdirectory-scoped Vale rule.
- [x] 4.4 Run runtime rules from the snapshot; delete
      `materializeRuntimeRules` and `RUNTIME_RUN_DIR`. A test edits a live
      `check.ts` after signing and asserts the snapshot's bytes executed.

## 5. Per-rule reconcile and the verdict policy (slice 3)

- [x] 5.1 Add `rules/report.ts`: discover every rule directory of every engine
      in the snapshot, refuse duplicate ids across engines (naming both
      directories), and build `{ ruleId, files: [{ path, signature }] }` with
      POSIX paths, excluding `.tests/**`. Tests: all engines reported,
      fixtures excluded, a duplicate id refused, `--rule` not narrowing.
- [x] 5.2 Add `rules/verdicts.ts`: turn a v2 reconcile response into a per-rule
      disposition (run / exclude / fail reason / notice) by engine per the
      table in design Decision 5, and compute accounting (a reported rule in
      zero or several of `rules`, `unknown`, `withheld` is unaccounted). Pure
      function, table-driven tests including an `unsafe` sg rule, a static and
      a runtime `unknown`, `missing`, withheld, unaccounted, and double-listed.
- [x] 5.3 Replace `planRuntime` with a `planCheck` that snapshots, reports,
      reconciles, applies dispositions, and removes excluded rules from the
      snapshot before assembly. Degrade paths (no token, `--anonymous`, no
      remote, 401, 404 `organization_not_found`, unreachable) run every static
      rule unverified and skip runtime rules, as today. Delete
      `repairWithheldRules`, `repair.ts`, and `run-set.ts`'s v1 helpers.
- [x] 5.4 Rewire `commands/check.ts` onto `planCheck`: exit 1 on withheld, an
      `unsafe` static rule, an unaccounted rule, or a duplicate id; one notice
      per `unsafe` naming each differing path and `taskless rule restore`; one
      notice per `missing`. `check.test.ts`, `runtime-check.test.ts`, and
      `mixed-engine-check.test.ts` cover each exit condition.
- [x] 5.5 Assert `check` never writes `.taskless/rules/`: a test hashes the tree
      before and after a run with `unsafe` and `missing` verdicts, and asserts
      no restore or fetch route was called.

## 6. check --json and recipes (slice 3)

- [x] 6.1 Add the optional `integrity` array to `schemas/check.ts` and emit it;
      keep `skipped`, `failures`, `notices`, and `entitlement` (withheld names
      resolved by rule id). Tests cover an `unsafe` entry with files, an
      unaccounted entry, and its omission on a clean run.
- [x] 6.2 Update the `check` and `ci` recipes: an edited static rule and an
      unaccounted rule fail the run; the fix is `rule restore`, not editing the
      rule back by hand; `missing` only warns. Update `create-runtime-rule`
      where it describes reconcile.

## 7. Recovery commands (slice 4)

- [x] 7.1 Add `rule restore <ruleId>` per the `cli-rule-recovery` spec: reuse
      the snapshot, report, and reconcile from group 5, read only the named
      rule's verdict, and build the expected signature map (`unsafe`) or
      revision (`missing`). Tests cover `run`, withheld, `unknown`, `unsafe`,
      and `missing`.
- [x] 7.2 Verify the served set against both its signatures and the
      expectation before writing; a mismatch exits `RULE_RESTORE_MISMATCH` and
      writes nothing. A test serves a newer revision for an `unsafe` rule and
      asserts the tree is untouched.
- [x] 7.3 Add `rule rollback <ruleId> <revisionId>`: served `revisionId` must
      equal the requested one; `revision_not_found` and `rule_not_found` map to
      their codes. Tests for each.
- [x] 7.4 Handle the refusal in both commands: print the sanitized `message` and
      `upgradeUrl`, write nothing, exit with `RULE_RECOVERY_NOT_IN_PLAN`.
      Add the new codes to `types/errors.ts`. Tests cover human and `--json`
      output.
- [x] 7.5 Add a `recover-rule` agent recipe (restore versus rollback, what a
      refusal means, recovering from git per the refusal's `message`) and link
      it from the `check` recipe's "An edited rule" section (slice 3 left the
      pointer out, since the topic did not exist yet).
      `recipe-cross-references.test.ts` passes.

## 8. Retire v1 (slice 5)

- [ ] 8.1 Delete `api/rules.ts` (its v1 request, poll, and iterate calls went
      in slice 2), `api/reconcile.ts`, `api/restore.ts`, the frozen v1
      `api.schema.json` / `api.d.ts`, the legacy single-`content` path in
      `files.ts` / `deliver.ts` (`writeRuleFile`, `writeRuleTestFile`,
      `writeRuleMetaFiles`, `deliveredFiles`, `resolveIngestEngine`), and
      every v1 type use; move `auth/whoami.ts` and `auth/org.ts` to v2 whoami. Verify
      `grep -rn "/cli/api/" packages/cli/src` finds only `/cli/api/v2/` paths.
- [ ] 8.2 Add a vite build check (per the code style guide, not a test that
      scans output) that fails the build if the bundle contains a `/cli/api/`
      string literal not followed by `v2/`, or delete the idea if the grep in
      8.1 plus the types already make a v1 call impossible to write. Record
      which, and why, in the PR.
- [ ] 8.3 Remove or rewrite what still exercises v1. Already gone in slice 3:
      `repair`, `repair-integration`, `runtime-dropped-rules`, the v1 relayout
      reconcile test, `api/reconcile.ts`, `api/restore.ts`, and the runtime
      `plan` / `repair` / `run-set` modules. Left for here: `api-deprecated-paths`,
      the v1 parser in `entitlement.test.ts`, and whatever 8.1 deletes.
      `pnpm test` passes.
- [ ] 8.4 Run `pnpm typecheck` and `pnpm lint` (which rebuilds and runs
      `pnpm cli check`) from the repository root; both pass.

## 9. End to end, then archive (slice 5)

- [ ] 9.1 From a nightly stamped `0.12.0-*`, against production v2, run the full
      round trip in an organization we own: `rule create` → `check` shows `run`
      → edit a signed file → `check` fails with `unsafe` → `rule restore` →
      `check` shows `run`. Repeat the edit on a vale rule's `.vale.ini`. Record
      commands and outputs in the PR.
- [ ] 9.2 Report the round trip to the cloud team so they can close TSKL-307.
- [ ] 9.3 File the follow-ups as issues: a rule-revisions list endpoint (enables
      rollback without the dashboard), plan features on `whoami`, the
      directory-swap gap, the superseded-revision signal, and the v1
      `Entitlement` type on served file sets.
- [ ] 9.4 Archive the change on the tip branch (`pnpm openspec archive
cli-v2-rule-api`), then re-run the scenario-survival check from 1.1
      against the archived specs.
