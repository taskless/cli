## Why

`pinned-cli-wrapper` moved agents, the skill, permissions, and CI onto the project launcher, `./.taskless/bin/cli.mjs`. Two places still sent people back to `npx`. Every remedy and hint the CLI prints for a person (`Run … auth login`, `Create one with … rule create`) named `npx @taskless/cli@<version>` even when the launcher had started the CLI. The `hooks` recipe told agents to add `@taskless/cli` as a dev dependency and run it from `node_modules/.bin`, which is a second pin to keep in step with `.taskless/taskless.json`.

## What Changes

- **Messages a person reads name the launcher that started the CLI.** The invocation shown in remedies and hints is the launcher's path when the launcher started the process, and the detected `npx`/`pnpm dlx` form otherwise. The two remedies that named the build's invocation directly (a pending migration, an unreadable manifest) use the same choice.
- **The scaffold README lists the project launcher first,** above the `pnpm dlx` and `npx` lines, which stay for a checkout where the launcher is not there yet.
- **The `hooks` recipe runs `node .taskless/bin/cli.mjs`.** It no longer adds a dev dependency or resolves a binary from `node_modules/.bin`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-project-launcher`: remedies and hints name the launcher that started the CLI.
- `cli-taskless-bootstrap`: the README lists the launcher first.
- `cli-agent`: the `hooks` recipe runs the launcher.

## Impact

- `packages/cli/src/util/package-manager.ts` (`getCliPrefix`), `filesystem/migrate.ts`, `filesystem/manifest.ts`, `filesystem/migrations/0001-init.ts`.
- `packages/cli/src/agent/hooks.md`.
- This repository's `.taskless/README.md`, regenerated to the template's output.
- Tests: `package-manager.test.ts`, `scaffold-readme.test.ts`, `prompts.test.ts`.
- Delivery shape: **single PR**, on the same pull request as `pinned-cli-wrapper`, which it finishes.
