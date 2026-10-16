## REMOVED Requirements

### Requirement: Codex install destination overrides the fallback for the same directory

**Reason**: It specifies an `AGENTS_FALLBACK` descriptor and a state-based cleanup helper that resolves descriptors by `installDir`, neither of which exists. `TOOLS` is detection-only, `SHIM_TARGETS` offers one `.agents` row, and `install/state.ts` diffs manifest targets by directory without any descriptor lookup. Its summary-labelling scenario contradicts "Wizard prompts the user to choose install locations", which reports the `.agents/` target as `Agent Skills`.

**Migration**: None needed. Naming Codex for `.agents/` is specified by "Wizard prompts the user to choose install locations" ("Codex is named in the tool list"). Installing to `.agents/` with nothing detected, or when the manifest records `.agents/`, is specified by "Agents fallback install" and by that same wizard requirement ("Agents is the default when nothing is detected or installed", "Manifest-recorded locations are pre-checked").
