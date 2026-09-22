## Why

taskless/cli#370 and #371 corrected the recipe and the `verify` advisory: a
`[.taskless/**]` matcher is not harmless. `check` excludes `.taskless/` from a
_whole-project walk_ only, so the matcher does nothing there — but on a path
named explicitly, such as the rule's own `.tests/fail` bucket, the matcher is
live and silences the rule. That is the shape that reproduces "`test` says the
fixture fired, `check` on the same fixture says nothing".

The recipe, the `update` ledger and the advisory string now all say both halves.
The standing spec does not. `cli-vale-rule-engine` still reads "`check` excludes
that tree before Vale runs, so the matcher acts only under a bare `vale`
invocation", and its scenario still requires `verify` to "report that `check`
already excludes that tree" — the exact imprecise phrasing the code no longer
ships. The spec is the source of truth for this capability, so leaving it
disagreeing with the advisory it describes is how the next author reproduces
#370 from the spec instead of the recipe.

This change carries no code. The implementation already landed in this PR; the
spec is what is behind.

## What Changes

- **`cli-vale-rule-engine`** — the advisory bullet and the
  `.taskless/**` scenario state both halves of the behaviour: unnecessary on a
  whole-project check, AND silencing on a named path. The scenario also gains
  the `check`-notices half that the other advisory scenarios already carry, so
  the two advisory paths are specified alike.

No requirement is added or removed, and no behaviour changes: this is the spec
catching up to an advisory string and a recipe that already shipped.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-vale-rule-engine`: "A rule's Vale config is validated against a schema
  before it is assembled" — the `.taskless/**` advisory bullet and its scenario
  are restated to match the shipped advisory.

## Impact

Documentation only. No source file, test, or public surface changes. The bump
stays `patch` and rides the existing changeset for this PR; no second changeset
is added.

## Delivery shape

**Single PR.** The spec correction is two edits inside one requirement and
belongs with the code change that made the standing text wrong, which is this
PR. It is the tip, so the change is archived here.
