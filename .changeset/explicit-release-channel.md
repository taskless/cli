---
"@taskless/cli": patch
---

A project installed with a local development build of the CLI no longer refuses the nightly and release builds afterwards. The CLI now knows whether it is a release, a nightly or a development build from how it was built, instead of guessing from its version number, and the version recorded in `install.launchers` is the one each project launcher and the version check use. Install advice about pinned CLI versions no longer suggests a nightly version that was never published.
