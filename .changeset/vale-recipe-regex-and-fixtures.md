---
"@taskless/cli": patch
---

`agent create-vale-rule` (topic v13) corrects two claims that cost rule authors work. Vale patterns are not RE2-only: Vale compiles with Go's `regexp` and falls back to `regexp2`, so lookahead, lookbehind and backreferences all work, and the recipe no longer tells you to split a rule that one pattern expresses. `check` on a rule's `.tests/fail` bucket is a supported way to read a rendered message, because `.taskless/` is excluded from the whole-project walk only; when that bucket comes back empty, the cause named is the rule's own `[.taskless/**]` matcher rather than the config.
