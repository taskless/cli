## Why

`cli-init` still carries the requirement "Codex install destination overrides the fallback for the same directory", which specifies machinery that no longer exists: an `AGENTS_FALLBACK` tool descriptor, and a "state-based cleanup helper" that resolves a descriptor by `installDir` and must prefer Codex over that fallback. `grep -rn "AGENTS_FALLBACK" packages/cli/src` finds nothing. `TOOLS` in `packages/cli/src/install/install.ts` is detection-only, the fixed `SHIM_TARGETS` catalog has a single `.agents` row (`label: "Agent Skills"`, `generic: true`), `DEFAULT_SHIM_DIR` is `.agents`, and `packages/cli/src/install/state.ts` has no tool-descriptor lookup at all: it diffs manifest targets by directory name.

Its scenarios are stale, contradicted, or covered elsewhere:

- "Codex detection labels the .agents/ install as Codex" requires the install summary to name Codex for `.agents/skills/` writes. "Wizard prompts the user to choose install locations" now says the `.agents/` target SHALL be reported in the install summary as `Agent Skills`, and names Codex on the picker row instead ("Codex is named in the tool list"). The two requirements contradict each other; the newer one matches the code.
- "Lookup by installDir resolves to Codex over fallback" tests a helper and a descriptor that do not exist.
- "Fallback still resolvable for legacy state without Codex detection" is covered by "Agents fallback install" (".agents stub written when no tools detected") and by "Wizard prompts the user to choose install locations" ("Manifest-recorded locations are pre-checked", "Agents is the default when nothing is detected or installed").

## What Changes

- Remove the requirement "Codex install destination overrides the fallback for the same directory" from `cli-init`. No behavior is dropped; no code changes.

## Delivery shape

Single PR. The change is one spec deletion with no implementation, so the spec edit and the archive land together.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-init`: one stale requirement removed.

## Impact

- `openspec/specs/cli-init/spec.md` only. No code, tests, or release note.
