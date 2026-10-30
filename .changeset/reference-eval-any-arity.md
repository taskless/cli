---
"@taskless/cli": patch
---

The `no-eval-call` entry in `@taskless/cli/reference.json` now flags a call to `eval` with any number of arguments, as its prompt asks, and carries a fail case for `eval()` and for `eval(a, b)`. Previously the reference rule matched exactly one argument, so a rule generated correctly from the prompt, with fixtures on each side of the arity boundary as `create-sg-rule` recommends, was graded against a reference that did not fire on them. The prompt now names the arities it expects. The corpus `version` is unchanged: the shape is the same, only the content of one entry moved.
