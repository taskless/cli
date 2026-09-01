---
"@taskless/cli": patch
---

A terminal `unsupported` now says why, instead of always blaming the plan.

The message was hardcoded to an entitlement explanation and ignored the
`error` the service sends with the status. That was accurate while the only
way to reach `unsupported` was an account lacking a capability. The service
now also terminates a request as unsupported when the CLI is below the floor
a runtime rule needs, and a user on an older CLI was being told to upgrade
their plan: they would ask an administrator for a capability they already
had, and the one command that would have fixed it was never mentioned.

The service's reason now wins whenever it sends one. The entitlement text
remains the fallback for an `unsupported` that arrives without a reason, and
a blank reason counts as none rather than printing a heading with nothing
under it.
