## 1. Messages a person reads

- [x] 1.1 Prefer a known launcher from `TASKLESS_LAUNCHER` in `getCliPrefix()`
- [x] 1.2 Route the pending-migration and unreadable-manifest remedies through `getCliPrefix()`
- [x] 1.3 List the package's launcher first in the scaffold README; regenerate this repository's `.taskless/README.md`
- [x] 1.4 Tests: `getCliPrefix()` with a launcher and with an unexpected value; README for release and nightly

## 2. Hooks recipe

- [x] 2.1 Rewrite `hooks` around `node .taskless/bin/cli.mjs`, drop the dev-dependency step, require the launcher, and bump the topic version
- [x] 2.2 Test that the rendered recipe runs the launcher and names no local binary

## 3. Release

- [x] 3.1 Extend the `pinned-cli-wrapper` changeset
- [x] 3.2 Run `pnpm typecheck` and `pnpm lint`
- [x] 3.3 Archive the change on the PR
