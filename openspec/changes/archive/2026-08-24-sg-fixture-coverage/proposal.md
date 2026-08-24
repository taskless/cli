## Why

`test` reports an ast-grep rule that has never been shown to fire as
passing. Layer 2 checks that a `-test.yml` **exists** and never reads
what is in it, and `ast-grep test` is content with an empty `invalid:`
bucket — `1 passed; 0 failed`, exit 0. A rule whose fixtures are all
`valid:` therefore reports `ok: true, ran: true` while `check` finds
nothing anywhere.

The spec already closes this for Vale — _"a rule populating only one
bucket SHALL be reported as unverified rather than passing"_ — with no
ast-grep counterpart, so it currently endorses the gap rather than
merely omitting it.

What made the gap visible is taskless/cli#152. A pattern like
`fetch($URL, $$$REST)` reads as "fetch with any trailing arguments" and
is not: the pattern's `,` is itself a node, and under ast-grep's default
`smart` strictness every pattern node must match, so a one-argument
`fetch(url)` has no comma to match against and the rule silently starts
at arity two. Upstream considers this working as intended
(ast-grep/ast-grep#1365) and 0.45.2 behaves identically, so there is no
version to upgrade to. The author-side remedy is `strictness: ast`
inside the pattern object.

The arity trap is the symptom; the reason it shipped undetected is that
nothing ever required the rule to demonstrate a match. A fixture in the
`invalid:` bucket would have caught it on the first run.

## What Changes

- **An sg rule's fixture coverage is classified and gates the test
  layer.** `verify.ts` reads the author's own test YAML and counts the
  `valid:` and `invalid:` entries across every `-test.yml` the rule
  owns, yielding `"both" | "valid-only" | "invalid-only" | "none"`.
  Only `"both"` can pass, mirroring `ValeFixtureCoverage` in
  `rules/vale/verify.ts` state for state.
- **`testOneRule` emits the coverage message**, in the wording the Vale
  branch beside it already uses — _"half a claim"_ for a one-sided
  bucket, _"nothing shows it fires or stays quiet"_ for none.
- **The `$$$` separator behaviour is pinned as a vendor contract.** The
  binary is exact-pinned, upstream calls this intended, and the failure
  mode is a rule that quietly matches a narrower set than its author
  wrote — so it belongs where a version bump that changes it fails
  loudly.
- **`verify --schema` gains a curated `strictness: ast` example.** The
  examples currently only ever show a standalone `$$$`, which is the one
  form that has no trap.

**Deliberately not done:** a static lint over pattern strings hunting
for a comma-adjacent `$$$`. `.conventions/STYLEGUIDE-CODE.md` warns
against reconstructing facts by parsing text, and the `>= 1` semantics
is sometimes exactly what the author meant — a rule about `fetch`
called _with_ options is a legitimate rule. It could only ever be an
often-wrong warning.

**Delivery is a single PR.** The coverage check, its tests, and the spec
delta are one reviewable diff, and the check is not correct in halves.

## Capabilities

### Modified Capabilities

- `cli-rule-validation`: `test` requires an ast-grep rule to populate
  both fixture buckets, on the same terms it already requires of Vale.

## Impact

- **Behaviour change.** Rules that passed `test` before this change now
  fail it — specifically any sg rule with an empty or absent `invalid:`
  bucket. That is the point of the change, but it is a rejection of
  previously accepted rules and the changeset says so.
- **Modified**: `packages/cli/src/rules/verify.ts` — `SgFixtureCoverage`,
  `fixtureCoverage()`, and a `fixtures` field on `TestLayerResult`.
  Exported because `TestLayerResult` is reachable from `verifyRule`'s
  return type under `declaration: true`.
- **Modified**: `packages/cli/src/rules/inspect.ts` — the sg branch of
  `testOneRule` builds its error list rather than forwarding
  `tests.errors` unchanged.
- **Modified**: `packages/cli/src/rules/verify-examples.ts` — a fourth
  curated example.
- **Modified**: `packages/cli/test/verify.test.ts` (one case per
  coverage state, plus one for summing across several test files) and
  `packages/cli/test/ast-grep-vendor-contract.test.ts` (six cases
  pinning `$$$` against the separator).
- **Unchanged**: `packages/cli/src/agent/*.txt`. The recipes should warn
  about the trap and about the arity-boundary fixture, but those files
  are being edited on a parallel branch and the prose lands at
  integration.
- **Out of scope**: the leading-`$$$` case (`foo($$$, $A)`), which
  `strictness: ast` does not rescue. Its remedy is an `any:` with one
  branch per arity, which is authoring guidance rather than a CLI
  change; it is pinned as a contract here and belongs in the recipes.

**Tracking:** taskless/cli#152
