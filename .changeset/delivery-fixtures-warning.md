---
"@taskless/cli": patch
---

A rule delivered without any `.tests/` fixtures is now reported, and still written. A fixture-less rule works; what it cannot do is demonstrate that it does, since `taskless test` reports a pass over zero executed cases and that reads exactly like a rule proven to work. The warning names the rule and says so.

Reported rather than refused, deliberately. The holder of a fixture-less rule did not author it and cannot add fixtures the service will bless, so a refusal would leave them with no action available. Warning first means a gap in the seam surfaces from a report rather than from a blocked user, and the decision to harden it into a refusal can be made on evidence.

The report reaches both audiences. Under `--json` the prose is suppressed and the message is carried in an optional `notices` array on `rule create` and `rule improve` output; otherwise it goes to stderr. A machine consumer cannot read stderr prose, and an unattended caller is the one most likely to act on a fixture-less delivery — `check` already settles this trade the same way. `notices` is optional, so every payload that parsed before still parses. The `create-remote-rule` and `improve-rule` recipes tell an agent to read it.

The warning is raised only when the rule genuinely has no fixtures, not merely when the payload carried none. `.tests/` survives a delivered set that does not mention it, and locally written fixtures accumulate there that no later set names by construction — so a locally tested rule, redelivered, would otherwise be told nothing proved it while the proof sat in the directory just written.

The service now requires fixtures at construction, so a delivery without them should not occur — but `files` is a flat `{path, content}[]` in the published contract, with nothing that says one of them must be a fixture. The requirement is real and not visible across the seam, which is why this is checked against what actually arrived.
