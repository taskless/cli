---
"@taskless/cli": patch
---

The installed Taskless skill's `metadata.version` now names the build that wrote it. A nightly or `self` build rewrote the skill body to pin itself but left the frontmatter at the last release, so `info` compared that stale stamp against itself and reported the skill current either way.
