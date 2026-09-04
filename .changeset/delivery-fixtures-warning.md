---
"@taskless/cli": patch
---

A rule delivered without any `.tests/` fixtures is now reported, and still written. A fixture-less rule works; what it cannot do is demonstrate that it does, since `taskless test` reports a pass over zero executed cases and that reads exactly like a rule proven to work. The warning names the rule and says so, and goes to stderr so it does not disturb `--json` on stdout.

Reported rather than refused, deliberately. The holder of a fixture-less rule did not author it and cannot add fixtures the service will bless, so a refusal would leave them with no action available. Warning first means a gap in the seam surfaces from a report rather than from a blocked user, and the decision to harden it into a refusal can be made on evidence.

The service now requires fixtures at construction, so a delivery without them should not occur — but `files` is a flat `{path, content}[]` in the published contract, with nothing that says one of them must be a fixture. The requirement is real and not visible across the seam, which is why this is checked against what actually arrived.
