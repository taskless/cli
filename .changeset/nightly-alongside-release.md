---
"@taskless/cli": patch
---

A nightly `init` installs beside the release and no longer offers to move `@taskless/cli` pins in scripts, CI, or hooks onto `@taskless/cli-nightly`. It also keeps the release's recorded version when the manifest predates `install.launchers`, so `.taskless/bin/cli.mjs` still has a version to run. A release `init` now retires the nightly: it removes `.taskless/bin/cli-nightly.mjs` and its lockfile, drops the nightly's recorded version and permission rules, and names any `@taskless/cli-nightly` pin left in scripts, CI, or hooks. Any `package.json` dependency on the CLI is now raised for removal in favour of the project launcher, and `pinnedCli` entries carry a `reason`.
