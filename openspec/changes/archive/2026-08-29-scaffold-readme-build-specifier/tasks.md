Delivery shape: **single PR**. One README producer, one printed line, one lint rule, tests, and a spec delta. The README fix is not meaningful without the guard that keeps it fixed, and neither is reviewable apart from the spec delta that records why the launcher menu stayed.

## 1. Fix

- [x] 1.1 Export `pinnedSpecifier()` from `util/package-manager.ts`, and drop its stale `dev` mention
- [x] 1.2 Build the README usage block from the specifier, keeping both launchers
- [x] 1.3 Emit the single invocation for a path-form (`self`) build, which has no launcher
- [x] 1.4 Route the `agent` topic index's human-facing hint through `applyCliInvocation`

## 2. Guard

- [x] 2.1 Add `no-unrouted-cli-invocation`, an ast-grep rule over `packages/cli/src/**`
- [x] 2.2 Exempt `util/invocation.ts` and `util/package-manager.ts`, where the canonical forms are defined
- [x] 2.3 Rule tests: routed calls and specifier-built launchers pass, both prior defects fail

## 3. Tests

- [x] 3.1 A nightly's README names the nightly on both launchers and the released package nowhere
- [x] 3.2 A released build's README is unchanged
- [x] 3.3 A path-form build names its one invocation and no launcher
- [x] 3.4 The `agent` index names this build's own invocation

## 4. Verification

- [x] 4.1 Confirm the regression test fails with the fix reverted, and the guard reports all three prior sites
- [x] 4.2 End to end: `pnpm build:nightly`, `init` into a scratch repo, read the generated README
- [x] 4.3 `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm cli check`
- [x] 4.4 `pnpm openspec validate --all --strict`
- [x] 4.5 Changeset
