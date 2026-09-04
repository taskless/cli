# Tasks

One PR. The runner and the reporting change are the same defect from two sides:
running the fixtures without fixing the report leaves a tick on a gated-out
rule, and fixing the report without the runner leaves every runtime rule
permanently unverified.

## 1. Read the fixtures

- [x] 1.1 Enumerate `.tests/pass/` and `.tests/fail/` one level deep, requiring each entry to be a directory (D3). A loose file names its own path in the error rather than being skipped
- [x] 1.2 Read the two buckets independently and rethrow anything that is not a missing directory, so an unreadable bucket cannot present as an empty one (D5)
- [x] 1.3 Classify coverage as `both` / `pass-only` / `fail-only` / `none`, and let only `both` reach a pass (D4)

## 2. Run them

- [x] 2.1 Execute the rule's `check.ts` once per case, with the case directory as the harness `root` (D3), through the existing `invoke.ts` rather than a second invocation path
- [x] 2.2 Require every `fail/` case to produce at least one finding, and every `pass/` case to produce none. Name the cases that broke either direction, the way the Vale runner names `missingFailures` and `unexpectedFindings`
- [x] 2.3 Treat a check that throws as a distinct outcome from a check that returned no findings. Both are zero findings downstream, and only one of them is the rule's fault
- [x] 2.4 Distinguish a case that never reached the check from one where the check found nothing (D8). `executeRuntimeRule` gates on the narrow and returns `[]` without invoking `check.ts`, so the runner needs the invocation signal rather than only the findings
- [x] 2.5 Report a case producing no narrow matches as a fixture defect in BOTH buckets, naming the case and saying the check never ran. A `pass/` case that never invokes the check proves nothing about the check staying quiet

## 3. Gate it on the flag, and only the flag

- [x] 3.1 Run fixtures only when `--dangerously-run-scripts` is passed. `test` does NOT reconcile: it runs fixtures because the user asked it to, so the verb is the consent (D1). `check`'s gate is untouched
- [x] 3.2 Add `--dangerously-run-scripts` to `test`, printing the same warning `check` prints, from one shared spelling so the two cannot drift
- [x] 3.3 Test that no rule id is special-cased, and that a gated-out fixture run executes nothing
- [x] 3.4 Test that the flag is the only mechanism at all. A fixture path is not a softer gate because its input is test data — and with no reconcile it is a stricter one, since a blessed rule that `check` runs unflagged still needs the flag here
- [x] 3.5 Test that the refusal never sends the author to `auth login`. Authenticating cannot bless a rule that never left the working tree, so naming it would be a fix that is not one (D6)
- [x] 3.6 Confirm nothing was orphaned by dropping reconcile from `test`. `createRuntimeGate`/`RuntimeGate` were `test`-only and are deleted; `planRuntime` and `repairWithheldRules` stay, `check`-only, in `rules/runtime/plan.ts`

## 4. Report a run that did not happen

- [x] 4.1 Stop returning `ok: true` from `testOneRule`'s runtime branch for a run that did not occur
- [x] 4.2 Render a skipped rule with its own marker and the reason, never a tick (D2)
- [x] 4.3 Stop counting a skipped rule in "N rule(s) tested"
- [x] 4.4 Make `ran` load-bearing in the `--json` envelope rather than advisory, and confirm the exit code does not fail on a gated-out run alone
- [x] 4.5 Say what to do about it: a rule that did not run because nothing blessed it should name `--dangerously-run-scripts` in the message (D6)

## 5. Prove it bites

- [x] 5.1 Reproduce the current defect first, as a failing test: a runtime rule whose fixtures never ran must not report `ok: true` and must not print a tick
- [x] 5.2 Test a rule whose `fail/` case produces no findings, which is the silent regression this exists to catch
- [x] 5.3 Test a rule whose `pass/` case produces findings, which is the indiscriminate rule
- [x] 5.4 Test each coverage class, asserting only `both` can pass
- [x] 5.5 Test that an unreadable bucket is an error and not an empty bucket (D5)
- [x] 5.6 Revert the runner and watch the suite fail before believing it. **Measured:** reverting the runner and the reporting fix (`git revert --no-commit` of both commits, confirmed applied by grep before running: no `run-fixtures.ts`, no `executeRuntimeRuleDetailed`, renderer back to `result.ok ? "✓" : "✗"`, runtime branch back to `ok: true`) and rebuilding gives **15 failed / 1190 passed of 1205**, one test file failing. Restored: **1205 passed**

## 6. Say so where an author reads it

- [x] 6.1 `create-runtime-rule` states that testing a locally authored rule needs the flag, and why (D6)
- [x] 6.2 `verify-rule` stops reporting runtime tests as "not run" without saying what was not run

## 7. Share the bucket reader rather than copying it a third time

- [x] 7.1 Extract the missing-versus-unreadable `readdir` discrimination and the four-way coverage classification to `rules/fixtures.ts`, and point `sg`, `vale` and `runtime` at it (D9)
- [x] 7.2 Extract the "half a claim" coverage message, which existed in three places. Keep the bucket suffix a parameter: `valid:` is a YAML key and `pass/` is a directory, so the difference is meaning rather than drift
- [x] 7.3 Keep each engine's rejection local. Vale refuses a nested DIRECTORY because its buckets hold documents; runtime refuses a non-directory because its buckets hold case directories
- [x] 7.4 Change no engine's observable behaviour. **Measured:** 75 files / 1205 tests before, 75 files / 1206 after, the one addition being 3.5's new test. `pnpm cli check` reports the same 4 pre-existing warnings either side

## 8. Close out

- [x] 8.1 Decide the no-fixtures case. **Settled: it fails, matching the other engines.** Every rule needs a fixture. Depth is not policed, so a trivial case that exercises little and passes is acceptable, but it can only live in `pass/` — a `fail/` case that produces nothing is the silent regression this runner exists to catch
- [x] 8.2 Tell the generator team, who have recorded this as a limit on what the demonstration can assert
- [ ] 8.3 **Carried out of this change as an owner TODO (Jakob), 2026-09-04.** Not done, and deliberately not blocking the archive. Confirm runtime deliveries carry `.tests/`. Not a request: a runtime rule ships with fixtures, and a delivery without them is a defect on their side (D7). If any do not, file it as a bug rather than proposing it as a contract change
- [x] 8.4 Once 8.3 confirms deliveries carry them, add fixtures to delivery completeness as its own change. Sequenced only so a service defect does not reach users as a refused write with nothing they can do about it
- [x] 8.5 Archive the change
