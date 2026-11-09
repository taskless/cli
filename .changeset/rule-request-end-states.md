---
"@taskless/cli": patch
---

`taskless rule create` and `taskless rule improve` no longer report success for a request that delivered nothing. A request that ends in `pr`, `merged` or `closed` (the pull-request delivery path, reachable through `--resume`), in a status this CLI does not know, or with no status at all, now fails with `RULE_GENERATION_FAILED` and a message naming the state, instead of printing the success envelope with `rules: []` and exiting 0.

Waiting on a request is also sturdier. The poll understands the service's `pushing` step and prints its own progress line for it, and a status the CLI does not know is now waited on rather than treated as final, so a step the service adds later does not end the wait early. The wait now has a 30-minute ceiling: a request that has not finished by then fails with `NETWORK_ERROR`, naming the last status and the `--resume` command that keeps waiting on the same request.
