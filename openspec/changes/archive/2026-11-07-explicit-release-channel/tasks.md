## 1. Channel from the build

- [x] 1.1 Add `Channel` and `buildChannel()` to `install/launcher.ts`, and derive `buildLauncherPackage()` from it
- [x] 1.2 Judge pins and name bump targets by channel in `install/pinned-cli.ts`; a self build moves no pin

## 2. Launchers as the record

- [x] 2.1 `recordedLauncherVersion` reads `install.launchers` alone once it records a version, and reads `cliVersion` only for a legacy manifest, where `-self` belongs to no package
- [x] 2.2 Apply the same rule in `assets/launcher/launcher.mjs`

## 3. Tests

- [x] 3.1 Version gate: a self install does not refuse a nightly or a release; `build:next` reads as nightly; `launchers` is the only source once present
- [x] 3.2 Launcher template: a `-self` cliVersion belongs to no launcher; `cliVersion` is ignored once `launchers` records a version
- [x] 3.3 Pins: a self build reports no command pin and names no bump target
