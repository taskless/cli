---
"@taskless/cli": patch
---

`agent create-vale-rule` (topic v13) corrects two claims that cost rule authors work. Vale patterns are not RE2-only: Vale compiles with Go's `regexp` and falls back to `regexp2`, so lookahead, lookbehind and backreferences all work, and the recipe no longer tells you to split a rule that one pattern expresses. `check` on a rule's `.tests/fail` bucket is a supported way to read a rendered message, because `.taskless/` is excluded from the whole-project walk only; when that bucket comes back empty, the cause named is the rule's own `[.taskless/**]` matcher rather than the config.

`verify` carried the same imprecision and now states both halves: a `[.taskless/**]` matcher is unnecessary on a whole-project check, AND it silences the rule on a path you name, such as the rule's own fixture bucket. It was previously described as acting only under a bare `vale` invocation, which read as harmless. `agent update` (topic v10) is corrected to match.
