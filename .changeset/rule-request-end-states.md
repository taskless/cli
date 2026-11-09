---
"@taskless/cli": patch
---

`taskless rule create` and `taskless rule improve` no longer report success for a request that delivered nothing. A request that ends in `pr`, `merged` or `closed` (the pull-request delivery path, reachable through `--resume`), in a status this CLI does not know, or with no status at all, now fails with `RULE_GENERATION_FAILED` and a message naming the state, instead of printing the success envelope with `rules: []` and exiting 0.
