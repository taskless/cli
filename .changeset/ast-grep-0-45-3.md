---
"@taskless/cli": patch
---

Update the bundled ast-grep to 0.45.3 (from 0.45.2).

What a rule author sees in `taskless check` on ast-grep rules:

- An inline `ast-grep-ignore` comment in scanned code now takes effect only when it is the comment's first alphabetic text. A comment that merely mentioned the directive as prose above a flagged line used to suppress the finding; it no longer does, so findings can appear that were hidden before. Move `ast-grep-ignore` to the start of the comment if the suppression was meant.
- The same prose mentions no longer produce `unused-suppression` hints.
- Rule files, `taskless verify`, and the language list are unchanged. Nothing installed under `.taskless/` needs migrating.
