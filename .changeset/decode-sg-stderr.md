---
"@taskless/cli": patch
---

Stop corrupting non-ASCII characters in ast-grep's error output.

`runAstGrepScan` and the runtime narrow both decoded ast-grep's stderr one
chunk at a time with `chunk.toString()`. A multi-byte UTF-8 sequence split
across a chunk boundary was decoded as two invalid sequences, and both halves
became replacement characters before the pieces were joined — the original
bytes unrecoverable by then. Each stream now uses a single `StringDecoder`,
flushed on close, matching what the Vale runner and `verify` already do.

The corrupted text only ever reached an error message, so no scan result was
ever wrong. But that message is the one a user reads when ast-grep rejects a
rule file, naming a rule id or a path — which is exactly where a non-ASCII
character turns up.
