## Why

`taskless test` reports a runtime rule as passing when its fixtures never ran.
Measured against a scaffolded project holding one runtime rule:

```
$ taskless test                    $ taskless test --json
✓ runtime/demo-probe               {"ok":true,"rules":[{"engine":"runtime",
                                     "ruleId":"demo-probe","ok":true,
1 rule(s) tested.                    "errors":[],"ran":false}]}
exit 0
```

`testOneRule` returns `ok: true, errors: [], ran: false` for the runtime engine,
and the human renderer reads only `ok` — `ran` exists in the `--json` schema and
nothing prints it. So the command whose job is to prove a rule fires says
"1 rule(s) tested" about a rule it did not test.

**This is an unimplemented requirement, not a missing feature.**
`cli-rule-validation` already says `test` executes a rule against "ast-grep test
cases, Vale `pass`/`fail` fixture buckets, or the runtime harness". Two of those
three are implemented and have scenarios. The third has neither, and its absence
is reported as success.

Three things make it worth doing now rather than later.

**Nothing else consumes a runtime rule's fixtures.** Delivery accepts `.tests/`
paths, `PRESERVED_SUBTREES` keeps them through a purge, and `strayModules`
exempts them at any depth so a TypeScript fixture does not trip the
one-executable-file rule. Every piece of support exists except the thing that
runs them.

**The demonstration depends on it.** The generator team withdrew the findings
the demo was going to serve, on the grounds that they are implied by delivery.
What a reader gets instead is a rule they can run — so a `test` that reports
green without running is, in their words, the difference between a
demonstration and a claim. They have recorded it as a limit on what their side
can assert.

**It is this repository's own named failure mode, in the command built to catch
it.** The same requirement says an engine "SHALL NOT be trusted to report this
itself", because `ast-grep test` calls an empty `invalid:` bucket a pass. The
runtime tier does the same thing one level up.

## What Changes

**A runtime fixture runner.** `test` executes a rule's `check.ts` against each
case under `.tests/pass/` and `.tests/fail/`, with the case directory as the
`root` the harness hands the check. A `fail/` case SHALL produce at least one
finding; a `pass/` case SHALL produce none.

**Gated by the gate that already exists.** Running a fixture executes delivered
code, so it runs under the same policy `check` uses: an authenticated reconcile
that returns the rule's signature in `run`, or `--dangerously-run-scripts`.
Neither is a new mechanism and no demo rule id is special-cased.

**A run that did not happen is reported as such.** Not as a pass, and not as a
failure. A rule that cannot run because nothing blessed it and no flag was
passed is not a defect in the rule, and failing it would turn `test` red for
every project holding a runtime rule with no way to make it green.

**Fixture coverage is classified, not counted.** Only a rule populating both
buckets can pass, which is what the requirement already demands of the other
two engines.

## Capabilities

### Modified Capabilities

- `cli-rule-validation`: the `test` requirement gains the runtime scenarios it
  names an engine for and never specified, plus the reporting rule for a run
  that was gated out.
- `cli-runtime-rule-execution`: gains the fixture runner and its gating.

## Impact

- `packages/cli/src/rules/runtime/` — a fixture runner that CALLS the existing
  executor rather than sitting beside it. `executeRuntimeRule` already takes a
  root, and `check` already passes the repository root through `dispatch.ts`;
  a case directory is a different root handed to the same function. What is new
  is the loop over cases and the pass/fail assertion, not the execution.
- `packages/cli/src/rules/inspect.ts` — `testOneRule`'s runtime branch stops
  returning `ok: true` for a run that did not happen.
- `packages/cli/src/commands/verify.ts` — the renderer distinguishes a skipped
  rule from a passing one, and the summary line stops counting it as tested.
- `packages/cli/src/schemas/verify-test.ts` — `ran` becomes load-bearing rather
  than advisory.
- No change to `check`, to reconcile, or to the execution gate itself.
