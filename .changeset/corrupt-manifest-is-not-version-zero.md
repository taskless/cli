---
"@taskless/cli": patch
---

A `.taskless/taskless.json` that cannot be parsed is now reported as an unreadable file rather than as "schema version 0", and `init` refuses it instead of overwriting it.

A manifest with a leftover merge conflict, a truncated write, or a partial editor save used to read as version 0. `check`, `verify` and `test` reported that guess as fact ("This project's .taskless/ is at schema version 0, and this CLI expects 6", from a file whose first line reads `"version": 6`), and the remedy they named destroyed the file: `init` re-ran every migration, re-read the manifest it still could not parse, and wrote back `{"version": 6}` with `install` (targets, cliVersion, onboarded) and `rules` (reconciledTo, engines) silently dropped.

Absent and unreadable are now different states. An absent manifest still migrates from 0, unchanged. An unreadable one produces the new `SCAFFOLD_MANIFEST_UNREADABLE` code, names the file and the parse error, and asks you to repair or delete it. `init` fails on it too, leaving the file byte-for-byte as it found it.

The interactive `init` wizard reads the manifest before it migrates anything, so it hits the same refusal. It now closes its own prompt frame with the repair-or-delete message rather than letting the error print after a frame nothing closed.

The new error code is added surface, not a rename, so no existing consumer changes behavior.
