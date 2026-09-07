---
"@taskless/cli": patch
---

Agent recipes are `.md` files rather than `.txt`, which is what they have always
been: headings, tables, fenced blocks and emphasis throughout. The extension is
not cosmetic. Vale has no markdown parser for a `.txt`, so every command example
and identifier inside a fence was prose to a prose rule, and two recipes had to
be exempted from the hedging rule entirely to keep the run quiet. Both are now
checked, with the one worked example marked in place. The markers are stripped
before a recipe is served, so nothing reaches a reader.
