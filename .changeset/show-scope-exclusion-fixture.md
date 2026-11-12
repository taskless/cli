---
"@taskless/cli": patch
---

Say how to show that a rule's scope excludes a path. The fixture layout in every authoring recipe, and `create-sg-rule`, now explain the working pattern: put the excluded file in a `pass/` case beside a clean file the scope admits. When `verify` rejects a `pass/` case because the scope excluded every file in it, the error now suggests the same thing alongside moving the fixture.
