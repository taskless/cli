## Why

`cli-version-pin-gate` made every CLI other than the recorded one refuse to run in a project, apart from `init` and a few diagnostics. What we still tell people to run did not catch up. The READMEs show `npx @taskless/cli check`. The `docs-npx-cli` Vale rule actively rewrites docs _toward_ `npx @taskless/cli <command>`. `init` run through npx ends by telling its reader to run `npx @taskless/cli@<version> update`. Each of those is a CLI the gate now refuses, or one that only works while npx happens to resolve the recorded version.

npx has one remaining job: installing or upgrading, through the wizard (bare) or `init`. Every other command goes through the project launcher.

## What Changes

- The `docs-npx-cli` Vale rule changes direction. In a README or `dotagents.md`, an npx, `pnpm dlx`, `yarn dlx`, or `bunx` run of the CLI is an error unless it is bare or `init`. `pnpm cli` stays banned in READMEs. Fixtures are rewritten to match.
- The root, package, and example READMEs run every command other than the install through `./.taskless/bin/cli.mjs`.
- `init`'s upgrade trailer names the launcher it just wrote for `update`, not the npx invocation that ran it.
- The bare, non-interactive notice sends its reader to the launcher for recipes when the project has one. The scripted-install line keeps the npx invocation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli`: follow-up commands printed by an install name the project launcher.

## Impact

- `.taskless/rules/vale/docs-npx-cli/`, `README.md`, `packages/cli/README.md`, `example/README.md`, `CONTRIBUTING.md`.
- `packages/cli/src/commands/init.ts`, `packages/cli/src/index.ts`, `packages/cli/src/install/upgrade-trailer.ts` (doc comment).
- This repo's own `.taskless/` still records 0.11.2 and is moved in a separate PR; its README is outside the rule's scope.
- Delivery shape: **single PR**, riding on `cli-version-pin-gate`'s PR. It finishes the same decision and is a small diff.
