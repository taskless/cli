---
"@taskless/cli": patch
---

`taskless rule meta` now says why it has no data, instead of reporting the rule as missing.

The `.taskless/rule-metadata/<id>.yml` sidecar is written from the `meta` block of a rule status response, and the rule service does not populate that block. No sidecar has ever been written, so `rule meta` failed with `RULE_NOT_FOUND` for every id, including rules plainly on disk. It now fails with the new `RULE_META_UNAVAILABLE` code and an explanation, and points at the ticket id that actually drives iteration.

The `improve-rule` recipe no longer routes through `rule meta`. It takes the ticket id from the `ruleId` field of `rule create --json`, which is the id the iterate endpoint is addressed by, and falls back to the local-only flow when nobody has it. `rule-meta`, `rule`, `delete-rule`, `create-remote-rule`, and `create-sg-rule` were corrected where they described the sidecar as something that exists.
