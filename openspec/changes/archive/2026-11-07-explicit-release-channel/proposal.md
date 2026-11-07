## Why

Several places decide which package a recorded version belongs to by whether the version contains a dash. A self build reports `<next>-self`, which has one, so it reads as a nightly. After a self install writes `install.cliVersion: "0.13.0-self"`, the version gate refuses a nightly ("this project runs @taskless/cli-nightly 0.13.0-self") and a release, the launcher cache keeps an entry for a version nothing published, and pin advice names `@taskless/cli-nightly@0.13.0-self`. Reported in taskless/cli#625.

## What Changes

- The running CLI's channel (`release`, `nightly`, `self`) comes from the build target, not from its version. Pin advice uses it, and a self build moves no pin, since it publishes no package.
- `install.launchers` is the only record of which version a package runs once it records any version. `install.cliVersion` is read only in a legacy manifest that predates `launchers`, and there a version ending in `-self` belongs to no package. `build:next` versions (`<next>-next-<sha>`) still read as nightly.
- The launcher template applies the same rule.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-project-launcher`: a launcher reads `cliVersion` only for a legacy manifest, and never as a self build's version.
- `cli`: the version gate follows the same rule, and takes the running package from the build target.
- `cli-init`: pin advice takes the running channel from the build target, and a self build moves no pin.

## Impact

- `packages/cli/src/install/launcher.ts`, `src/install/pinned-cli.ts`, `assets/launcher/launcher.mjs`.
- Deferred: a scaffold migration that moves a legacy `cliVersion` into `launchers`. The next install by a current CLI already carries it there, and a legacy manifest that is never reinstalled is still read correctly, so the migration would only remove the legacy read path.
- Delivery shape: **single PR**. The rule change and its spec fit one review.
