---
"@taskless/cli": minor
---

**Breaking: the two rule-checking commands are renamed for the question each one answers.**

| 0.13       | before 0.13 | question                                                               |
| ---------- | ----------- | ---------------------------------------------------------------------- |
| `validate` | `verify`    | Is the rule well formed? Decided from its files alone.                 |
| `verify`   | `test`      | Does the rule check what you want? Runs `validate`, then the fixtures. |

What to change:

- **A call to `taskless test`** fails as an unknown command. Call `taskless verify`. The output is the same.
- **A call to `taskless verify`** still runs, but it now runs the rule's fixtures as well, so it is stricter and slower. For the old quick check, call `taskless validate`. The JSON envelope is unchanged.
- **A pre-commit hook installed from the `hooks` recipe** runs `taskless test` and fails after the upgrade until it says `taskless verify`.
- **The `verify-rule` agent topic** is now `validate-rule`.
- **The `./schemas` export `verifyTestOutputSchema`** is renamed `ruleCheckOutputSchema`, with no alias. The schema itself is unchanged.
- **`@taskless/cli/reference.json`** moves to `version` 3. Its shape is unchanged, but `enforcedBy` now reads `"validate"` or `"verify"`, so each value names a different command than it did in version 2. The corpus's own `version` is the signal a consumer should refuse on, not the package version.

Installed skills pin their CLI version, so a project keeps the old names until it upgrades, and the upgrade rewrites the skill with the new ones.
