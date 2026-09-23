## Why

`test --json` reports a boolean per rule and nothing else:

```json
{
  "ok": true,
  "rules": [
    {
      "engine": "vale",
      "ruleId": "no-hedging",
      "ok": true,
      "errors": [],
      "violations": [],
      "ran": true
    }
  ]
}
```

`check <fixture path> --json` over the same rule's `fail/` fixture returns three findings carrying a rendered `message`, `file`, `range`, `matchedText` and `severity`. The rendered message is what a verdict cannot express: a `substitution` rule whose message interpolates its captures can have the `%s` slots in the wrong order, fire on every `fail/` fixture, stay quiet on every `pass/` one, and be reported as a rule that passed. An agent authoring a rule has no way to see the message it wrote except by running a second command against a path it has to construct.

The findings already exist in-process and are discarded at a seam:

- **Vale** — `packages/cli/src/rules/vale/verify.ts` reduces `outcome.results`, a `CheckResult[]`, to `firedIn`, a `Set<string>` of file paths, and derives `missingFailures`/`unexpectedFindings` from the set. Message, range, matched text and severity die at that line.
- **Runtime** — `packages/cli/src/rules/runtime/run-fixtures.ts` reads only `execution.findings.length`. `findings` is a `CheckResult[]`.

So this is plumbing rather than a new engine invocation: no extra subprocess, no second scan, nothing re-run.

## What Changes

- **`test --json` carries a `findings` array on every rule result**, each entry the `CheckResult` shape `check --json` already prints plus a `bucket` of `"pass"` or `"fail"`. `CheckResult` is reused verbatim rather than narrowed: it is already the published shape for a finding, and a second shape is a second thing to keep in sync.
- **The array is always present, never omitted.** Empty for an ast-grep rule, for a rule whose `verify` failed before fixtures ran, for a refused runtime rule, and for a rule that simply produced nothing. A key that is sometimes absent is one a consumer learns to treat as optional, and the reading that follows is that absence means zero — which is exactly the inference this change exists to make unnecessary.
- **Fail-bucket findings are reported on a green run.** They are the `%s`-order evidence, and a payload that carries the evidence only once the rule is failing carries it at the one moment it is no longer needed.
- **The human path keeps one line per passing rule.** Under a failing rule the offending findings print underneath, labelled by bucket, through `util/format.ts`'s existing `formatText` — the same renderer `check` uses, over the same `CheckResult[]` it takes as its parameter. A pass-bucket finding prints there: today `unexpectedFindings` names the file that wrongly fired and stops, which says _that_ it happened and not _what_ matched. Fail-bucket findings are not dumped on a green human run; that is what `--json` is for.
- **No new flag.** No `--verbose`: it has no precedent anywhere in `packages/cli/src` or `openspec/specs`, and the house pattern is a rich `--json` beside a terse human render. No `--include-fixtures` on `check` either: an explicit fixture path already works, because the `.taskless/**` exclusion in `rules/vale/run.ts` is gated on `wholeProject`. A flag an agent has to know to pass is the ergonomics problem being filed, not its fix.
- **Vale's `unexpectedFindings` and `missingFailures` are left alone.** They are internal to `ValeRuleVerification`, and whether the findings array subsumes them is a separate decision from whether the findings are reported at all.
- **ast-grep reports an empty array in this PR.** `runTests` spawns `sg test` and regex-parses `test result: ok. N passed; N failed;`. The vendored 0.45.3 binary has no `--json` and no output-format flag, and its fixtures are inline YAML scalars rather than files, so there is no directory to attribute a finding to. Surfacing them needs a different mechanism, which is PR 2.

## Delivery shape

**Stacked, merging forward — this is the bottom PR of two.** Each unit reaches production on its own: this one plumbs the two engines that already hold `CheckResult[]`, and an ast-grep rule reporting `findings: []` is true rather than misleading, since the array's contract is "present and empty when there is nothing to report". PR 2 adds ast-grep, which needs a way to get structured output out of a binary that offers none, and would otherwise hold a working feature behind an unrelated investigation. The changeset lands here, at the bottom, and PR 2 extends it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-rule-validation`: "Test runs a rule's fixtures and runs verify first" restated to require the per-rule `findings` array, its always-present-and-possibly-empty contract, fail-bucket reporting on a green `--json` run, and the human rendering under a failing rule.

Deliberately untouched: "A rejection names the constraint it violated", which governs `violations[]`. Those are CONSTRAINT violations — what a rule broke about its own shape — and a fixture finding is what a rule reported about a document. Conflating the two is the confusion this change is correcting.

## Impact

- `packages/cli/src/schemas/verify-test.ts`: `findings` on `ruleResultSchema`, the `CheckResult` shape plus `bucket`, defaulted to `[]` so the field is present in output for `verify` as well as `test`.
- `packages/cli/src/rules/vale/verify.ts`: keep the `CheckResult[]` beside `firedIn` and attribute each finding to a bucket by its file path.
- `packages/cli/src/rules/runtime/run-fixtures.ts`: keep `execution.findings`, tagged with the case's bucket.
- `packages/cli/src/rules/inspect.ts`: `findings` on `RuleTestResult`, populated per engine and empty on every early return.
- `packages/cli/src/commands/verify.ts`: the human render under a failing rule.
- Tests: `packages/cli/test/test-fixture-findings.test.ts`.
- `.changeset/test-show-fixture-findings.md`.
