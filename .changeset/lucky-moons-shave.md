---
"@taskless/cli": patch
---

Reclaim a reference stub whose recovery instruction names a CLI build you are no longer running.

Every stub outside `.taskless` ends with the line that makes a missing canonical file recoverable: "If `<path>` does not exist, run `<command>` from the project root to restore it, then read it." That command was frozen at whichever build wrote the stub. Install a nightly once and go back to the released CLI and every install afterwards reported "up to date" while the line kept pointing at `npx @taskless/cli-nightly@<pinned>` — a version that may no longer be published, in exactly the situation where the reader has nothing else to fall back on.

An install now rewrites a stub whose recovery command names a build other than its own, with one exception: the released, version-free `npx @taskless/cli init` is left alone by every build. It resolves for any reader, so a nightly has no reason to replace it, and the released and nightly builds do not rewrite each other's stubs on repeat installs. Stub bytes written by a released build are unchanged.
