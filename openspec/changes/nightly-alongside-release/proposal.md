## Why

Moving a production project from the nightly back to mainline showed the two channels are not symmetric in the way they should be. Installing a nightly should put it beside the release without switching what scripts, CI, and hooks run; installing the release should clean the nightly up. Neither held. A nightly `init` offered to move the project's `@taskless/cli` script, CI, and hook pins onto `@taskless/cli-nightly`, and on a project whose manifest predates `install.launchers` it overwrote the only record of the release's version, leaving `.taskless/bin/cli.mjs` with nothing to run. A release `init` left the nightly's launcher, lockfile, recorded version, and permission rules in place, and said nothing about a nightly pin newer than the release, since staleness alone never names a newer version. Separately, the CLI runs through the project launcher, yet any `package.json` dependency on it was judged only by version, so a current dependency, which drifts behind `.taskless/` on the next upgrade, went unmentioned.

## What Changes

- **A nightly installs beside the release.** It never offers to move a `@taskless/cli` pin in a script, CI file, or hook. When that nightly migrated an existing `.taskless/`, a release pin is still named, marked "leave as is", with a warning that a release predating the new schema refuses the project. A nightly install carries the release's version into `install.launchers` even when only `install.cliVersion` recorded it.
- **A release install retires the nightly.** It removes `.taskless/bin/cli-nightly.mjs` and `cli-nightly.lock.json`, drops the nightly's `install.launchers` entry (so its cached build is pruned), removes the nightly's rules from harness permission files, and raises every `@taskless/cli-nightly` pin in a script, CI file, or hook, whatever its version. `init --json` gains `retired`, the launcher files removed. The user-level global trust entry is not touched: other projects may still use the nightly.
- **A dependency on the CLI is raised whatever its version.** Any `@taskless/cli` or `@taskless/cli-nightly` entry in `dependencies`, `devDependencies`, or `optionalDependencies` is named for removal in favour of the project launcher. Version judgement now applies to script, CI, and hook lines only.
- **`pinnedCli` entries carry a `reason`**: `dependency`, `stale`, `nightly`, or `unreleased`. `findStalePins` becomes `findCliPins` and takes the run's migration. The notice is headed `TASKLESS CLI PINS`, gives each entry its action, and adds one paragraph per reason present.
- **Recipes**: `init` (v15), `update` (v20), and `info` (v4) explain the reasons and the release's retirement of the nightly.

## Capabilities

### Modified Capabilities

- `cli-init`: the two pin requirements are replaced by "Init raises Taskless CLI pins"; "Each permission file holds exactly one Taskless rule" is replaced by "Each permission file holds one Taskless rule set per installed package"; the launcher and lockfile requirements gain the release's retirement of the nightly.
- `cli-project-launcher`: "Each package has its own launcher" lets a release remove the nightly's launcher.
- `cli`: "Info reports stale CLI pins" is restated for the new entry shape.

## Delivery Shape

**Single PR.** Detection, its notice, the JSON shape, the retirement, and the recipes that read them only make sense together.
