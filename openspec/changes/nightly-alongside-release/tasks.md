## 1. Pins

- [x] 1.1 In `install/pinned-cli.ts`, raise every dependency as `dependency`; judge script, CI, and hook lines by channel (`nightly`, `unreleased`, or `stale`). Rename `findStalePins` to `findCliPins` and pass the run's migration from `init` and the wizard.
- [x] 1.2 Rewrite `getPinnedCliNotice` with a per-entry action and one paragraph per reason; add `reason` to the `pinnedCli` schema and relabel plain `info`.

## 2. Launchers and permissions

- [x] 2.1 In `applyInstallPlan`, carry both packages' versions from the previous record, including one only `cliVersion` implied; on a release, drop the nightly's entry and remove its launcher and lockfile, reported as `retired`.
- [x] 2.2 In `syncPermissions`, have a release invocation remove the nightly's rules.

## 3. Recipes and tests

- [x] 3.1 `init`, `update`, `info`: describe `reason` and `retired`.
- [x] 3.2 Tests for pins, retirement (release and nightly projects), and permissions.
- [x] 3.3 `pnpm typecheck`, `pnpm lint`, and the CLI test suite pass.
