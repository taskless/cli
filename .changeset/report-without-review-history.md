---
"@taskless/cli": patch
---

Onboarding now mines commit history for fixes that recur, alongside review comments. In a repository reviewed before its pull requests open, or written mostly by agents, the commits are often the only place a rule-shaped pattern shows up. The report recipe states that only review comments count toward `surfaced`. A fix-up commit, a blame date, or a finding today does not.

`taskless report` follows the current tskl.es ReportV1 schema, which prices reviewer time, agent tokens, and dollars on the server. The payload no longer carries `projection` or a rule's `complexity`, and the facts file no longer accepts `estimates`. Each Taskless Cloud candidate in the facts now requires `estimatedViolations`, the agent's estimate of how many instances of its pattern are in the code today.
