## Why

`route.txt` tells an agent to pick an engine and gives it no way to know
what either local engine can read. The engine table is entirely about
evidence _shape_ — one file's tree, a document's words, more than one
file — and says nothing about language reach. The closest it comes is an
Important Note asking the agent to "choose an engine whose availability
you can assert," which asks for an assertion the recipe never equips it
to make.

The reported case is concrete: two GitHub Actions workflow rules were
routed to `create-runtime-rule`, which requires a login, because nothing
said whether ast-grep parses YAML. It does — `Yaml` is one of the 26
languages the pinned `@ast-grep/cli@0.41.0` lists in `sg run -h`.

Nothing in the repository could have answered the question.
`src/generated/ast-grep-rule-schema.json` types `$defs.Language` as a
bare string with no enum; `verify` never validates a rule's `language`,
so any spelling passes locally and fails inside the binary; and
`detect --json` reports the _repository's_ languages in a different
vocabulary (`C++` where ast-grep says `Cpp`). Vale self-reports nothing
at all. The binaries are the only authority.

## What Changes

- **A new `packages/cli/src/rules/capabilities.ts`** carries each local
  engine's reach as pure data, pinned to the engine version it was taken
  from. Pure is load-bearing: `src/prompts/recipes.ts` is a Worker-safe
  surface and `assert-prompts-graph` fails the build if the prompts
  chunk reaches a host capability, so the constants cannot be read from
  a binary or a file at render time.
- **The recipes state reach through `%(…)s` variables**, resolved from
  those constants rather than transcribed into the `.txt`. Transcribed
  lists would drift on the next engine bump with nothing to catch them,
  and a stale claim about what an engine can read is worse than the
  silence it replaces — an agent acts on it.
- **`route.txt` (topic v1 → v2)** gains a reach block in step 4: what
  `sg` parses, that an Actions workflow is `Yaml` and `Yaml` is on the
  list, Vale's markup / comments-only / plaintext-fallback tiers, and
  the converter-dependent formats Vale cannot read at all. It also
  states that a language on neither list does **not** route to runtime by
  default — `create-legacy-rule` is checked first, because the repo's own
  linter may already speak it.
- **`create-vale-rule.txt` (topic v2 → v3)** repeats the reach where a
  matcher is actually authored, and stops offering `[*.{md,mdx}]` as the
  worked example of widening a glob. That example is a trap: one `.mdx`
  file fails the entire Vale pass.
- **Two vendor-contract test blocks** pin the constants to the binaries.
  ast-grep is asserted by set-equality against `sg run -h`; Vale, which
  self-reports nothing, is probe-measured, with each tier separated by a
  construct that distinguishes it from the fallback.

**Delivery is a single PR.** Constants, recipe text, spec delta, and
tests are one reviewable diff, and no slice of it is independently
useful — the constants exist only to be rendered, and the recipe text is
wrong without them.

## Capabilities

### Modified Capabilities

- `cli-rule-routing`: the `route` recipe states each local engine's
  language reach, derived from the pinned engine versions rather than
  transcribed into the recipe text.

## Impact

- **Added**: `packages/cli/src/rules/capabilities.ts` — pure data, no
  imports at all.
- **Modified**: `packages/cli/src/prompts/recipes.ts` — six new entries in
  `buildVariables`, all build-time constants. Compatible with the
  `TASKLESS_CLI` rule that a recipe variable is an argument and never an
  ambient read: nothing here touches `process`.
- **Modified**: `packages/cli/src/agent/route.txt` (topic v1 → v2) and
  `packages/cli/src/agent/create-vale-rule.txt` (topic v2 → v3).
- **Modified**: `packages/cli/test/ast-grep-vendor-contract.test.ts` and
  `packages/cli/test/vale-vendor-contract.test.ts` each gain a separate
  top-level `describe` for the capability constants;
  `packages/cli/test/recipe-cross-references.test.ts` gains a block
  asserting the constants reach rendered text;
  `packages/cli/test/prompts.test.ts` has its `buildVariables` key list
  and its prompts-import allowlist extended.
- **Out of scope**: bumping Vale past 3.18.0, where MDX parses natively
  and `.mdx` leaves the converter-dependent list. The constants are
  shaped so that bump is a one-file edit.
- **Out of scope**: a runtime guard that catches an `E100` before it
  takes down a `check`. This change makes the hazard visible at authoring
  time; it does not defend against one already committed.
- **Out of scope**: extending `detect --json` with an `engines` block.
  `openspec/specs/cli-detect/spec.md` frames `detect` as an offline scan
  of the _repository_; engine reach is knowable at build time and does
  not need a third subprocess turn in a recipe already spending two.

**Tracking:** taskless/cli#151
