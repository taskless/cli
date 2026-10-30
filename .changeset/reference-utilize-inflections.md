---
"@taskless/cli": patch
---

The `prefer-use-over-utilize` entry in `@taskless/cli/reference.json` now flags `utilized` and `utilization`, as its prompt asks, and carries a fail case for each. Previously the reference rule missed both, so a rule generated correctly from the prompt was graded against a reference that did not fire on those cases. The prompt now names the forms it expects. The corpus `version` is unchanged: the shape is the same, only the content of one entry moved.
