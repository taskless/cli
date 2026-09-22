---
"@taskless/cli": patch
---

`verify` warns when a Vale rule's `raw` list has more than one entry, since Vale concatenates them into one pattern rather than alternating them; the `create-vale-rule` recipe explains the `(a|b)` form. The warning rides on `notice` and does not fail the rule.
