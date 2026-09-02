---
"@taskless/cli": patch
---

`route` is now exported from `@taskless/cli/prompts`.

It was withheld because it contains local mechanics a service consumer cannot
run, and because a consumer could adjudicate ambiguous calls from the three
authoring recipes. Both halves were wrong in the same way. The mechanics are
real and a consumer ignores them, which is a smaller adaptation than restating
the criteria; and adjudicating from the destinations is what the platform
generator actually tried. It hand-wrote the same judgement, arrived at
`static | runtime` with nowhere to put `vale`, and generated every prose rule as
an ast-grep rule while its own delivery layer could already serve a Vale one.

Exporting a chooser without its destinations strands a consumer that can route
but not author. Exporting destinations without the chooser strands one that can
author but not route, and it writes its own chooser rather than stopping.
