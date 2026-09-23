---
"@taskless/cli": patch
---

`verify` now rejects a Vale `substitution` rule whose `swap` key carries a backreference. No capture group survives a swap key: Vale compiles a rule's keys into one alternation, wrapping each in a capture group of its own and rewriting the author's groups to non-capturing, so `\1` refers to Vale's wrapper and matches nothing. Vale reports none of this, so the rule loads, runs and silently never fires. The detector is character-class aware, since `\1` inside `[…]` is an octal escape and works. `$1` in the swap _value_ is unaffected and still works. The `create-vale-rule` topic goes to v14: the claim that Vale tries Go's `regexp` before falling back to `regexp2` is removed (there is no fallback; it compiles with `regexp2` unconditionally), the `swap` constraint is generalised, and the leading-lookbehind mirror of the trailing-lookahead limit is documented.
