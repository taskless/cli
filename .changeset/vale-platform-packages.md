---
"@taskless/cli": minor
---

Ship Vale as per-platform binary packages.

The CLI now declares `@taskless/vale-<os>-<cpu>` as `optionalDependencies` pinned
to an exact version, so installing it also brings down a verified Vale binary for
the host platform — no lifecycle script, and nothing to download at runtime. Only
the matching platform installs; unsupported hosts install cleanly with none
present and continue to fall back to a `vale` found on `PATH`.
