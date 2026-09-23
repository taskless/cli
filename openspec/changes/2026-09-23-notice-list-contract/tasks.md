## 1. Implementation

- [x] 1.1 Add `packages/cli/src/util/notices.ts` as a leaf module with no
      imports of its own, exporting `collectNotices`, which drops `undefined`
      and `""` and preserves order.
- [x] 1.2 Cut the unreachable `?? outcome.message` fallback in the Vale
      dispatch `unavailable` branch.
- [x] 1.3 Carry notices as `string[]` through `EngineOutcome`,
      `ValeAttempt`/`ValeRunOutcome`, `ValeVerifyResult`, `SchemaLayerResult`,
      `RuleVerification` and `RuleTestResult`, so `DispatchResult.notices` is
      genuinely flat.
- [x] 1.4 Remove the space join in `rules/verify.ts`, so `language.notices`
      contributes elements like every other producer and no second separator
      convention remains.
- [x] 1.5 Fix `check`'s renderer to prefix every line of every notice, the
      defect `241e1c4` fixed in `verify` and left live in `check`.
- [x] 1.6 Replace the published `notice?: string` with `notices: string[]` in
      `verifyOutputSchema.schema`, `valeVerifyOutputSchema` and the
      `verify`/`test` envelope.
- [x] 1.7 Mark the runtime plan's notices too. They were printed by their own
      loop with no marker while the dispatched ones were marked, though
      `--json` merges both into one array.
- [x] 1.8 Share one `markNotice` helper between `check` and `verify`, so the
      two renderers differ only in the marker.

## 2. Tests

- [x] 2.1 Unit-test `collectNotices`: order preserved, `undefined` dropped,
      `""` dropped, empty in empty out, multi-line notice left as one element.
- [x] 2.2 Add the missing end-to-end test of `check`'s TEXT output: two
      advisories, two `Notice: ` lines.
- [x] 2.3 Assert `check --json` publishes them as separate elements, none
      spanning lines.
- [x] 2.4 Unit-test `markNotice` on a multi-line notice, and assert
      end-to-end that the runtime plan's warning is marked.
- [x] 2.5 Strengthen the three separator-blind tests to assert on elements
      rather than `toContain` over the whole field.

## 3. Spec

- [x] 3.1 Add the rendering and list contract to `cli-check`.
- [x] 3.2 Add the list contract to `cli-rule-validation`.
- [x] 3.3 Add the separate-advisories contract to `cli-vale-rule-engine`.
- [x] 3.4 Dry-run `openspec archive` and diff requirement and scenario counts
      per capability to prove nothing standing is dropped.
