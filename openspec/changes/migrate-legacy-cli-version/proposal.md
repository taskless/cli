## Why

`explicit-release-channel` made `install.launchers` the record of which version each package runs, but kept a legacy-only path: a manifest written before `launchers` existed was still read through `install.cliVersion`, classifying its channel off the version string. That path lived in four places (the version gate, the install carry-forward, the launcher cache prune, and the launcher template), and it is the last place the CLI reads a channel off a version. Step 3 of taskless/cli#625 asked for a scaffold migration that moves the legacy value once, so the read path can go. The upgrade process is now well defined, so the scaffold bump is acceptable.

## What Changes

- Scaffold migration 13 moves a legacy `install.cliVersion` into `install.launchers`, under the package that published it. A `-self` version or a non-version records nothing. It preserves every other field and is idempotent.
- The version gate, the install carry-forward, and the cache prune read `install.launchers` alone. `recordedLauncherVersion` and `legacyChannel` are deleted; the legacy classification lives only in the migration.
- The launcher template reads `install.launchers` alone. It is only written by `init`, which migrates first, and every CLI since `launchers` existed keeps the field when it rewrites the manifest.
- The scaffold version advances to 13. A CLI older than this refuses the project as "scaffold newer than this CLI", which is accepted.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-taskless-bootstrap`: adds migration 13.
- `cli-project-launcher`: a launcher reads `install.launchers` only.
- `cli`: the version gate reads `install.launchers` only.
- `cli-init`: the install relies on migration 13 instead of carrying a legacy `cliVersion` forward itself.

## Impact

- `packages/cli/src/filesystem/migrations/0013-launchers-from-cli-version.ts`, `src/filesystem/migrate.ts`, `src/install/launcher.ts`, `src/install/install.ts`, `src/install/version-gate.ts`, `assets/launcher/launcher.mjs`.
- This repository's own `.taskless/taskless.json` advances to scaffold version 13.
- Delivery shape: **single PR**, added to #631, which introduced the record this migration completes.
