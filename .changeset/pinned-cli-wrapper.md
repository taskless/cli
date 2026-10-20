---
"@taskless/cli": patch
---

`init` now installs a project launcher, `.taskless/bin/cli.mjs` (`cli-nightly.mjs` for a nightly), that runs the CLI version recorded for it in `.taskless/taskless.json`. The installed skill and recipes fetched through the launcher name it instead of a pinned `npx` call, so the skill no longer changes on every release, and every harness's permission file gets a version-free rule for it. The `ci` recipe now generates `node .taskless/bin/cli.mjs check`, with Node supplied by the job, so a repository without a `package.json` can run Taskless in CI. The `hooks` recipe runs the launcher too, instead of adding `@taskless/cli` as a dev dependency. When the launcher started the CLI, the commands it prints for you to run next name the launcher, and `.taskless/README.md` lists it first.

Each package's Claude Code `autoMode.allow` entry now also covers its own launcher, so one time only, the wizard offers to replace the existing entry. More than one string under a package's label now counts as stale, and the wizard folds them into one. Settings edits are colored as migrations: `ALLOW` green, `REMOVE` uncolored, `REPLACE` yellow, and `SKIPPED` red, which marks an edit you have to make yourself. A missing or stale global entry after `init` prints as a red `SKIPPED (global):` line.
