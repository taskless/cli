---
"@taskless/cli": patch
---

Onboarding now mines commit history for fixes that recur, alongside review comments. In a repository reviewed before its pull requests open, or written mostly by agents, the commits are often the only place a rule-shaped pattern shows up. The report recipe states that only review comments count toward `surfaced`. A fix-up commit, a blame date, or a finding today does not. When every `surfaced` count is zero, the agent now tells the user why the report's estimate reads $0 (review raised none of these patterns, not because the rules catch nothing) and points to what the rules found in the code today.
