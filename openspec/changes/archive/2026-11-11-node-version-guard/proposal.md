## Why

The CLI requires Node `>=22.22.0` (`engines.node`), but on an older Node it fails with an error that never mentions the version. Two runs in the CLI agent survey hit it: `init` on Node 20.19 crashed with a `SyntaxError` because `node:fs` has no `globSync`, after only npm's `EBADENGINE` warning. The crash is a link error in the CLI's static imports, so a check inside the CLI never runs.

## What Changes

- The package `bin` becomes a small shim (`dist/bin.js`) that compares the running Node against `engines.node`, then dynamically imports the CLI (`dist/index.js`). On an older Node it prints `taskless: Taskless needs Node >=22.22.0, you have 20.19.0. Install a newer Node and run it again.` and exits 1, loading nothing else. This covers `npx @taskless/cli` and `pnpm dlx`.
- The project launcher checks the same thing before it installs (from `engines.node` in its lockfile) and before it starts an installed version (from that version's `package.json`), with the same message and exit 1.
- The `ci` recipe says the job needs Node 22.22 or later.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli`: a new requirement that the `bin` checks the Node version before loading the CLI.
- `cli-project-launcher`: a new requirement that the launcher refuses a Node older than the package's `engines.node`.

## Impact

- `packages/cli/src/bin.ts`, `packages/cli/src/node-version.ts`, `packages/cli/vite.config.ts` (a second program entry and the `__TASKLESS_NODE_ENGINE__` define), `packages/cli/package.json` (`bin`), `packages/cli/assets/launcher/launcher.mjs`, and the `ci` recipe.
- `dist/index.js` stays the CLI and keeps its shebang, so `pnpm cli`, CI and the `self` build run it as before.
- Delivery shape: **single PR**. Two small guards, their tests, and a recipe line.
