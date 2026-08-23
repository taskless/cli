---
"@taskless/cli": patch
---

Onboarding now reads the routing surface before it proposes rule candidates.

The `onboard` recipe asked the agent to synthesize its bullet list of
hypothetical rules first and consult `route` only afterwards, once per accepted
bullet. So the list a user picked from was written without knowing what kind of
rule anything would be, or what the repository already lints — and a candidate
with nowhere to go looked exactly like a good one until the user had already
chosen it.

The recipe now fetches `taskless agent route` and runs `taskless detect --json`
before proposing anything, and each bullet carries the destination it would
route to: `- no-direct-db-access [sg]: …`. The annotation is provisional —
`route` still decides for real at materialization time, when it has the rule's
full description — but an unroutable candidate is now visible while it is still
cheap to drop.

The destination criterion itself has not moved. It is still defined once, in
`route`; onboarding reads it rather than carrying a copy that would drift.
