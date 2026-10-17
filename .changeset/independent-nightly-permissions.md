---
"@taskless/cli": patch
---

The release and a nightly no longer undo each other's permissions. `init` now replaces stale project allow rules only for the package it is installing (`@taskless/cli` or `@taskless/cli-nightly`), and leaves the other package's rules in place. Each package also gets its own Claude Code `autoMode.allow` entry: the release keeps the `Taskless CLI:` label, and a nightly uses `Taskless CLI nightly:`. Neither build reads the other's entry as stale. One time only, the wizard offers to replace an existing `Taskless CLI:` entry that names both packages with the release-only text.
