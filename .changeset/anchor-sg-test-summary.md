---
"@taskless/cli": patch
---

Fix the pass/fail counts reported when a rule's `ast-grep` tests fail.

`ast-grep test` echoes the source of a failing test case, and `verify` scraped
its counts with unanchored regexes over stdout and stderr combined — so a
fixture containing text like `'7 passed; 0 failed'` was read as the summary and
`verify` reported `✗ failed (7 passed, 0 failed)` for a run that actually had 0
passed and 1 failed. The counts are now read from the summary line itself
(`test result: ok.` / `Error: test failed.`), with ANSI colors stripped first.

This only affected the reported numbers, never the pass/fail verdict, which
comes from the exit code — but those numbers are handed to the agent driving
`improve-rule`, where a wrong count can steer the next edit. Test output is also
now decoded with a `StringDecoder` per stream, so a multi-byte character split
across a chunk boundary is no longer mangled.
