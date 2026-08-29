## Why

Codex is detected, routed to `.agents/`, and fully supported. The word
"Codex" never appears in the list the user actually reads.

The install wizard keeps two lists. `TOOLS` drives detection and knows about
Codex. `SHIM_TARGETS` drives the "which tools do you want to enable Taskless
for?" multiselect and offers `Claude Code / Cursor / OpenCode / Agent Skills`.
A Codex user reads that list and concludes we do not support their harness,
because the support arrives under a label that only makes sense once you
already know `AGENTS.md` is the thing Codex reads. Someone who believes their
harness is unsupported does not file a bug, they leave.

## What Changes

- **The picker gains a `Codex` row pointing at `.agents/`.** Two rows now name
  the same directory. That is the point: people scan the list for the name of
  the tool they use. `Agent Skills` stays, because it is the entry that serves
  anyone on a harness the catalog does not enumerate.
- **The catalog becomes a list of rows, not a list of directories.** Every
  consumer that turns rows into directories or into install targets now goes
  through a single deduplicating helper, so a shared directory is pre-checked
  once, planned once, written once, and reported once. The dedupe is on `dir`,
  not on the Codex row, so a future pair of rows sharing a destination
  inherits the invariant.
- **The generic hint follows the generic row.** `generic agent skills` belongs
  to the `Agent Skills` row; the `Codex` row hints `detected` or
  `not detected` like any other named harness.

**Delivery is a single PR.** One catalog row, one helper, three call sites,
tests, and a spec delta. No unit of this is meaningful on its own.

## Capabilities

### Modified Capabilities

- `cli-init`: the tool-selection step names Codex, and a directory offered by
  more than one row installs exactly once.

## Impact

- **Modified**: `packages/cli/src/install/install.ts` (the `Codex` row,
  `uniqueShimTargets`, `detectSelectedDirectories`, `buildInstallPlan`),
  `packages/cli/src/wizard/steps/locations.ts` (pre-checked set and hints),
  `packages/cli/test/install.test.ts`,
  `packages/cli/test/wizard-steps.test.ts`.
- **Unchanged**: detection, the canonical store, the stub format, and the
  install manifest, which has always been keyed by directory.

**Tracking:** taskless/cli#204
