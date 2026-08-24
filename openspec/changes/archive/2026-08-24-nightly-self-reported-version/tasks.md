Delivery shape: **single PR**. A pure function, one call site, tests, and a spec delta — nothing here can land independently of the rest.

## 1. Reproduce before fixing

- [x] 1.1 Build a nightly locally (`TASKLESS_NIGHTLY_VERSION=… pnpm --filter @taskless/cli build:nightly`) and confirm it reports the committed version while pinning the nightly invocation — the two halves of the report, from one artifact
- [x] 1.2 Confirm the write path is not itself at fault: `wizard/index.ts` persists `getCliVersion()`, and reads `previousState.cliVersion` only to render the diff, so nothing is preserving a stale value

## 2. Fix

- [x] 2.1 Add `resolveCliVersion(environment, packageVersion)` to `build-target.ts`, delegating to `resolveNightlyVersion` for the nightly target so the no-stamp refusal is shared rather than restated
- [x] 2.2 Read it from the `__VERSION__` define in `vite.config.ts`
- [x] 2.3 Leave `assert-skill-versions` reading `pkg.version` — it asserts about committed source, not about the build

## 3. Tests

- [x] 3.1 Nightly reports the stamped version, not the committed one
- [x] 3.2 A nightly with no stamp throws, naming the env var
- [x] 3.3 prod/dev/self and an empty environment all keep the committed version

## 4. Verification

- [x] 4.1 Nightly build reports the stamped version in `--version` and in the recipe header
- [x] 4.2 Prod build still reports the committed version
- [x] 4.3 End-to-end: `init` under a nightly build writes the stamped version to `install.cliVersion`
- [x] 4.4 `pnpm --filter @taskless/cli build` then `test`, `pnpm typecheck`, `pnpm lint`, `pnpm openspec validate --all --strict`
- [x] 4.5 Changeset
