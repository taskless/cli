---
"@taskless/cli": patch
---

Tell the routing recipe what the local engines can actually read.

`route` chose between `sg`, `vale`, and the runtime tier on the shape of the
evidence alone, and had nothing to say about language reach — so a rule over a
GitHub Actions workflow was escalated to `create-runtime-rule`, which needs a
login, because nothing stated that ast-grep parses YAML. It does. Nothing in
the repository could have said so either: the vendored ast-grep schema types
`language` as a bare string with no enum, `verify` never checks the field, and
`detect --json` reports the repo's own languages in a different vocabulary.
Vale self-reports nothing at all.

`route` now states both engines' reach, and `create-vale-rule` repeats Vale's
where a matcher is written. Both read the lists from constants pinned to the
engine versions this CLI ships, rather than from prose typed into the recipe —
an engine bump that changes what a binary parses now fails a vendor-contract
test instead of leaving a confident, wrong sentence in front of an agent.
Vale's reach was measured by probing the shipped binary, tier by tier, since it
publishes no capability listing.

The Vale half carries a hazard worth naming on its own. Vale supports
reStructuredText, AsciiDoc, XML, DITA, and MDX by shelling out to an external
converter, and this CLI ships none of them — so one such file caught by a
rule's glob exits 2 with an `E100` and abandons the whole run, silencing every
other Vale rule over every other file. `create-vale-rule` had been offering
`[*.{md,mdx}]` as its example of widening a matcher.
