## 1. Remove the stale requirement

- [x] 1.1 Confirm `grep -rn "AGENTS_FALLBACK" packages/cli/src` finds nothing and that each scenario of "Codex install destination overrides the fallback for the same directory" is stale, contradicted, or covered by another `cli-init` requirement
- [x] 1.2 Add a `## REMOVED Requirements` delta for it; verify `pnpm openspec validate remove-agents-fallback-requirement --strict` passes
- [x] 1.3 Archive the change and verify, by diffing the sorted `#### Scenario` lines of `openspec/specs/cli-init/spec.md` before and after, that only the removed requirement's three scenarios disappeared
