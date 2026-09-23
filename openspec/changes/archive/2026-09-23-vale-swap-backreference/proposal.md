## Why

A backreference in a Vale `swap` key can never match, and Vale says nothing
about it. The rule loads, runs on every document, writes nothing to stderr, and
reports no finding. A silently dead rule is indistinguishable from a clean
project, so the author's own `fail/` fixture is the only thing that can catch
it — and by then they have already written the rule.

The cause is not the regex engine. Vale compiles every pattern with `regexp2`
in RE2 compatibility mode, unconditionally (`internal/regex/regex.go:63`), so
backreferences work under `tokens`, under `raw`, in a `consistency` key and in a
`conditional` `first`. It is that **no capture group survives a `swap` key**:
`NewSubstitution` compiles all of a rule's keys into one alternation, wrapping
each key in a capture group of its own because the index of the group that
matched is how it recovers the replacement. Those wrappers must be numbered
1..n, so any group the author wrote is rewritten to `(?:…)` by
`convertCaptureGroups` first. Either way `\1` points at Vale's wrapper — the
group still being matched — and matches nothing.

The standing spec covers the neighbouring case and not this one. "Behavior a
schema cannot express stays explicit" is scoped to a rule shape that _crashes_
the binary; this shape does not crash it, and the justification a crash supplies
(one config for the whole run, no findings for any rule) is not available here.
That gap is what this change closes: it states when the schema may reject a
pattern the binary accepts, and what such a rejection owes the author.

## What Changes

- **`cli-rule-validation`** gains one requirement covering a rejection for a
  pattern the binary accepts but can never honor, with the evidence bar and the
  message obligations such a rejection carries.

Code, already implemented on this branch:

- The Vale style-layer schema rejects a `swap` key carrying a live
  backreference. The detector is character-class aware, because inside `[…]` a
  `\1` is an octal escape and the key works.
- `create-vale-rule` goes to topic v14: the two-engine fallback claim is
  removed (it was never true), the `swap` constraint is generalised from "a
  backreference does nothing" to "no capture group survives a swap key", the
  `$1`-in-the-value asymmetry is documented, and the leading-lookbehind mirror
  of the existing trailing-lookahead limit is added.
- `vale-vendor-contract.test.ts` pins the mechanism, the false-positive
  candidates, and — newly — that `consistency` and `conditional` are NOT
  affected, so a widening of the blast radius is caught rather than assumed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-rule-validation`: one ADDED requirement. No standing requirement is
  restated, renamed or removed.

## Impact

One new schema rejection, `patch`. The migration cost was measured: across the
seven published Vale style packages plus this repository's own rules, 1,502
`swap` keys in 161 rule files, **0** carry a live backreference. `check` is
unaffected (it does not run the style-layer schema over authored rules the way
`verify` does), and `test` already fails a rule whose `fail/` fixture never
fires.

## Delivery shape

**Single PR.** The spec, the schema change, the recipe bump and the tests are
one reviewable diff and are only correct together. It is the tip, so the change
is archived here.
