---
"@taskless/cli": patch
---

Four agent recipes (`create-vale-rule`, `route`, `update`, `verify-rule`) had their bodies changed since v0.11.0 without their `# Topic:` version being bumped, so a consumer with a cached copy had no signal that the content moved. Their topic versions are now bumped to match, so a stale cache is refetched. `verify-rule` is the one that matters most: a cached v2 describes a reporting contract the CLI no longer emits, missing the `○` mark for a rule that did not run, the `refused` field, and the instruction to read `ran` before `ok`.
