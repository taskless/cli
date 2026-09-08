---
"@taskless/cli": patch
---

Fixed `check --json` reporting a `raw`-scope Vale finding's `range.start.line`
one line earlier than the flagged text (#297). A `raw` pattern is
conventionally anchored with a leading `\n` so it can require "start of line"
against the unparsed document; that `\n` is part of Vale's reported match, and
Vale attributes `Line` to the newline ending the previous line rather than to
the line the flagged text is actually on. The mapper now counts a match's
leading newlines and adds them back before converting to the 0-indexed
`CheckResult.range` every source uses.

`default`-scope findings were not affected: Vale already reports the correct
1-based line for them, and `range.start.line` is 0-indexed by design (every
source in `CheckResult.range` is — `format.ts` adds 1 back when it displays,
and #297's "off by one" for default-scope rules was this documented
convention compared against a 1-based file line, not a bug).
