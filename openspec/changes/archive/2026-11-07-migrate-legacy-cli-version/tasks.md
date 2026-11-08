## 1. Migration

- [x] 1.1 Add migration 13 (`0013-launchers-from-cli-version.ts`) and register it; it moves a legacy `cliVersion` into `launchers`, records nothing for `-self` or a non-version, preserves every other field, and is idempotent
- [x] 1.2 Advance this repository's own `.taskless/taskless.json` to scaffold version 13

## 2. Remove the legacy read path

- [x] 2.1 Delete `recordedLauncherVersion` and `legacyChannel` from `install/launcher.ts`; `pruneLauncherCache` reads `launchers` alone
- [x] 2.2 The version gate and the install carry-forward read `launchers` alone
- [x] 2.3 The launcher template reads `launchers` alone

## 3. Tests

- [x] 3.1 Migration 13: release, nightly and `build:next` versions move; `-self` and non-versions do not; an existing record is left alone; other fields survive; a rerun is a no-op
- [x] 3.2 Version gate and launcher template no longer read `cliVersion`; fixtures that seeded a legacy manifest record `launchers` or go through the migration
