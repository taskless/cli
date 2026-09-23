## 1. Spec

- [x] 1.1 Confirm no standing requirement governs a rejection for a pattern the
      binary accepts; "Behavior a schema cannot express stays explicit" is
      scoped to a shape that crashes the binary.
- [x] 1.2 Add the requirement as an ADDED block, so nothing standing is
      restated and nothing can be dropped by archive.
- [x] 1.3 Dry-run `openspec archive` and compare the scenario count in
      `cli-rule-validation` before and after.

## 2. Schema

- [x] 2.1 Reject a `swap` key carrying a live backreference, in the style
      layer, per rule.
- [x] 2.2 Make the detector character-class aware, so `[\1a]` is accepted.
- [x] 2.3 Scope the rejection to `substitution`, since the permissive checks
      decode loosely and a `swap` map on one reaches the check.
- [x] 2.4 Write the message so it carries its own justification: the key can
      never match, Vale reports nothing, the rule is silently dead — and say to
      write an `existence` rule instead.

## 3. Recipe

- [x] 3.1 Remove the two-engine fallback claim; Vale compiles with `regexp2`
      unconditionally.
- [x] 3.2 Generalise the `swap` constraint to "no capture group survives a swap
      key", with all four measured forms.
- [x] 3.3 Document that `$1` in the swap value works, and that `\1` in a
      character class works.
- [x] 3.4 Add the leading-lookbehind mirror of the trailing-lookahead limit.
- [x] 3.5 Bump the topic to v14.

## 4. Tests

- [x] 4.1 Detector, both directions: the four inert forms rejected, the
      false-positive candidates accepted.
- [x] 4.2 Vendor contract: correct the mechanism comment, pin the no-capture-
      group forms, the character class, the `$1` value, and the lookbehind.
- [x] 4.3 Vendor contract: measure `consistency` and `conditional` so a
      widening of the blast radius is caught rather than assumed.
