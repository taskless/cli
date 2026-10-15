---
"@taskless/cli": patch
---

Released builds now pin their own version. The installed skill and the `agent` recipes name `npx @taskless/cli@<version>` instead of the unpinned `npx @taskless/cli` or `@latest`, as nightlies already did, so an agent runs exactly the version the project installed. Commands the CLI prints for you, such as an authentication remedy, are pinned the same way. Upgrading is unchanged: re-run `init`. Two places stay unpinned: a reference stub's reinstall line, so stubs do not change on every release, and `.taskless/README.md`, which is written once and read across upgrades.

`init` now also reports stale Taskless pins in CI and git-hook files (GitHub Actions, GitLab CI, CircleCI, husky, lefthook, pre-commit, and the rest of the files `detect` recognizes) by file and line, through the same notice and `pinnedCli` JSON field as `package.json` pins. It recommends the version to move to and never edits the file.
