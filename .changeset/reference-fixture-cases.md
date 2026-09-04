---
"@taskless/cli": minor
---

`@taskless/cli/reference.json` now states how its fixtures group into cases, and names the tree its paths are relative to. `version` is `2`.

`tests` was a flat `{ path, content }[]`, so recovering which files belong to which case meant knowing that a `runtime` case is a directory, a `vale` case is a document, and an `sg` rule's cases are `valid:`/`invalid:` keys inside one ast-grep test file. That is a fact about this repository, and every consumer transcribed it. It cost the Cloud eval team a rule that failed the fixtures shipped beside it: their request format carried one anonymous blob per case, so the two-file `runtime` case could not be expressed and the rule was graded against half of itself.

`tests` is now an object carrying a `grouping` discriminant, the same file list, and — for the groupings the CLI itself defines — the cases, each naming the path a runner is handed and the files it holds. `sg` publishes `grouping: "ast-grep-test"` and no cases, because that grouping lives inside ast-grep's own documented schema rather than ours.

A new top-level `layout` block publishes the rule tree — `.taskless/rules/{engine}/{id}`, which file is the rule for each engine, where its config and captures go — and each entry carries its own resolved `directory` and `ruleFile`. Without it the corpus published paths relative to a root it never named, so a consumer materializing a rule had to assume where the CLI looks. Every value is generated from the table the CLI dispatches on, so it cannot describe a layout the CLI does not implement.

`taskless verify --json` and `taskless test --json` now report, per rule, which published constraint a rejection violated: `violations` pairs a `constraintId` from `reference.json`'s `constraints[]` with the message reporting it. `errors` is unchanged and still carries every message, so this is additive — a consumer reading only `errors` sees what it saw before. Previously, mapping a rejection back to the rationale the corpus publishes meant matching on our wording, and rephrasing an error message is not a breaking change, so that mapping rotted silently.

An error no published constraint describes is left unattributed rather than given the nearest plausible id, because a wrong attribution sends a reader to a rationale that does not explain their failure.

`@taskless/cli/layout` gains `TASKLESS_DIRECTORY` and each engine's `fixtureLayout`.
