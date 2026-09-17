# Tasks

**Delivery shape: single PR.** A spec correction with no code change; the
behaviour it describes already ships, pinned by
`packages/cli/test/vale-vendor-contract.test.ts` ("LAST assignment wins").

## 1. Spec

- [x] 1.1 Restate the per-rule scoping requirement in full with the measurement moved to Vale 3.21.0 and the repeated-key bullet reading last-wins
- [x] 1.2 Add a scenario for a key repeated inside one matcher
- [x] 1.3 `pnpm openspec validate --strict`, then the archive dry-run from CLAUDE.md: every prior scenario still present after archive
