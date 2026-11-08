---
"@taskless/cli": patch
---

A project installed with a local development build of the CLI no longer refuses the nightly and release builds afterwards. The CLI now knows whether it is a release, a nightly or a development build from how it was built, instead of guessing from its version number, and the version recorded in `install.launchers` is the one each project launcher and the version check use. Install advice about pinned CLI versions no longer suggests a nightly version that was never published.

The `.taskless/` scaffold advances to version 13. Its migration moves a version recorded only as `install.cliVersion`, by a CLI that predates `install.launchers`, into `install.launchers`, so the CLI and the project launcher read that field alone. Run `init` to apply it. A CLI older than this release refuses a migrated project as newer than it understands, so update any pinned CLI in CI along with the migrated files.
