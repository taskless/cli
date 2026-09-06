---
"@taskless/cli": patch
---

A runtime rule can no longer disappear from `check` without being reported. An
unreadable `captures/` directory was read as "this rule has no captures", so the
rule was dropped before it was signed and appeared in neither the executed nor
the skipped list: `check` printed nothing about it and exited 0. The same
swallow made an unreadable `.tests/` directory report as a missing fixture.
Separately, a rule blessed by the server and then lost during materialization is
now reported as skipped, whatever caused the loss.
