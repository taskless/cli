---
"@taskless/cli": patch
---

Four error messages now give a remedy that works as written. On a plan without rule recovery, `check`'s git steps restore a rule from the commit before the one that changed it (`<commit>~1`), and from `HEAD` when the change is not committed yet; restoring from the change itself put back nothing for a deleted rule. A rule id held by two engines now says to rename the locally written rule rather than the issued one, and lists where the id appears inside it. Migration 5 no longer asks for migration 4 to be re-run, which nothing can do, and says to move the loose rule files by hand and run `init` again. `update --rules` on a project with no `.taskless/` names `init` instead of "run the CLI once". Error codes are unchanged. The `check` agent recipe moves to topic v6.
