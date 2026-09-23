---
"@taskless/cli": patch
---

`test` now reports the findings an ast-grep rule's fixtures produced, with the
message as ast-grep rendered it. Previously only Vale and runtime rules carried
`findings`; an ast-grep rule reported an empty array, so a rule whose message
interpolated its metavariables in the wrong order fired in exactly the right
places and was reported green.

Each snippet is replayed through `ast-grep scan --stdin`, so the language comes
from the rule's own `language:` key and no temporary file is written. A finding
names the test YAML that declares the snippet, at the snippet's real line and
column in that file.

Additive, and `patch` under the pre-1.0 rule: the `findings` array was already
present on every rule result and documented as possibly empty, so nothing a
consumer reads changes shape. Vale and runtime behaviour is untouched, and the
verdict `ast-grep test` decides is unchanged — findings are gathered after it
and cannot alter it.
