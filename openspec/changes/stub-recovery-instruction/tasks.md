Delivery shape: **single PR**. Two string builders, one install predicate, tests, and a spec delta. No unit of this is meaningful on its own.

## 1. Fix

- [x] 1.1 Add the recovery sentence to `buildSkillStub` and `buildCommandStub`
- [x] 1.2 Route the invocation through `applyCliInvocation`, so a `dev`/`self`/`nightly` build names the binary that wrote the stub rather than the released package
- [x] 1.3 Name `init` rather than a bare run, which installs only from a TTY
- [x] 1.4 Add `stubPredatesRecovery` and let `referenceNeedsRewrite` rewrite such a stub once
- [x] 1.5 Update this repository's own committed stub

## 2. Tests

- [x] 2.1 Both stubs carry the instruction and name the build's own invocation
- [x] 2.2 Stub bytes do not move with the CLI version
- [x] 2.3 A stub predating the instruction is rewritten; a current one is not

## 3. Verification

- [x] 3.1 End to end: install into a scratch directory, delete the canonical file, read the stub
- [x] 3.2 `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`
- [x] 3.3 `pnpm openspec validate --all --strict`
- [x] 3.4 Changeset
