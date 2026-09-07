---
"@taskless/cli": patch
---

Agent recipes are `.md` files rather than `.txt`, which is what they have always
been: headings, tables, fenced blocks and emphasis throughout. Vale has no
markdown parser for a `.txt`, so every command example and identifier inside a
fence was prose to a prose rule, and two recipes had to be exempted from the
hedging rule entirely to keep the run quiet. Both are checked now. The
`create-vale-rule` recipe gains a section on writing an exception zone, with the
measured constraint on where the directives can go.
