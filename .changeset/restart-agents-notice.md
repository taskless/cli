---
"@taskless/cli": patch
---

`init` now prints a banner when an install moves the CLI version, telling you to
reload skills or start a new session.

An AI tool reads its skill and command listing once, at session start, so a
session that is open during an upgrade keeps serving the previous copy for the
rest of its life. Nothing errors. Because a Taskless recipe is embedded in the
bundle at build time rather than fetched, a stale skill names a stale CLI
invocation and serves a stale recipe, so the answer is wrong rather than
missing.

The banner fires on a version move in either direction, which covers an upgrade,
a downgrade, and a stable/nightly swap. A first install is not a move and stays
quiet, as does re-running an install on the version already recorded.
