## Why

A rule's behaviour is a property of the engine version that executes it, not of
the version it was written against. The Taskless Cloud generator verifies a
generated runtime rule in a sandbox that pins `@ast-grep/cli` **0.41.1** by hand
in a Dockerfile, while `taskless check` on a developer's machine runs this
package's pinned **0.45.2**. Four minors apart. A capture that narrows
differently across them verifies clean on their side and matches nothing on
ours: a rule that passes its gate and never fires, with both sides reporting
success. That is live right now.

The Dockerfile's own comment says the pins exist so the check validates "with
the same ast-grep the rule was generated against". Generation never runs
ast-grep. The version that matters is the one that **executes** the rule, and
that is this CLI's.

There is no way to close that gap by pinning harder. Two teams tracking the same
engine version in two places drift, and the drift is silent in exactly the
direction that hurts. What removes it is making the engine version a consequence
of the CLI version rather than a parallel fact: the consumer installs the pinned
CLI, its optional dependencies bring the platform binaries, and it asks our
resolver where they are. The versions then move together because they are the
same pin.

## What Changes

- A new published entry, `@taskless/cli/node/runtimes`, exporting the CLI's own
  `resolvePlatformBinary`, the `AST_GREP_BINARY` and `VALE_BINARY` specs, and
  the types a consumer needs to hold the result.
- `AST_GREP_BINARY` moves from `rules/scan.ts` to `rules/ast-grep-binary.ts`, so
  a consumer that wants a path does not load a scanner to get one. Vale's spec
  already sits in a leaf module.
- The build's entry classification becomes exhaustive. `LIBRARY_ENTRIES` is
  opt-in, so before this change an export that joined no list was checked by
  nothing, and forgetting was indistinguishable from a deliberate exemption.
  Every published export must now name itself as either graph-asserted or
  deliberately host-bound, and the build fails on one that does neither.
- The CLI-entry half of the graph guard now asks about the bin entry's **module
  id** rather than the bin **chunk's** file name, and applies to host-bound
  entries too.

**No change to `resolvePlatformBinary`'s contract.** It returns
`{ path: undefined, tried }` rather than throwing, because `check` must lose one
engine rather than the whole run. A verifier wants the opposite and will fail
closed on `undefined` itself; the entry documents that the return is a value
precisely so each side can decide.

## Capabilities

### New Capabilities

- `cli-runtime-binary-export`: the published entry that resolves the engine
  binaries this CLI executes, and the build-time classification that keeps every
  published entry's host access declared rather than assumed.

## Impact

- New public surface on `@taskless/cli`. Additive; nothing existing changes
  shape. `patch` under pre-1.0 guidance, where `minor` is reserved for breaking
  changes.
- `@taskless/cli/prompts` and `@taskless/cli/layout` are unaffected. Their graphs
  stay host-free and the build still refuses to emit them otherwise — the new
  entry is excused from that rule by name, not by absence.
- Consumers gain a reason to depend on the CLI package from a service, so the
  entry's Node requirement is stated in its import path (`node/`) where a reader
  meets it before a build error does.

## Delivery shape

**Single PR.** One entry module, one spec relocation, one build guard, and the
spec delta that records why the exemption is legitimate. The guard is the half
that makes the exemption reviewable, so splitting it out would ship a new
unchecked published surface for as long as the two halves were apart — which is
the exact failure the guard exists to prevent.
