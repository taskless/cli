---
"@taskless/cli": patch
---

Stop a rule with no tests from failing every other rule's ast-grep test run.

Migration `0005` created a rule's `.tests/` only as a side effect of moving a test file into it, so an ast-grep rule that had no test at version 3 — or one whose test file did not match the `<id>-YYYYMMDD-test.yml` shape the migration can attribute to a rule — arrived in the new layout with no tests directory at all. Assembly then named that directory as a `testConfigs` entry anyway, and ast-grep 0.41.0 treats a `testDir` it cannot read as fatal to the whole invocation rather than to the one rule: `taskless test` on _any_ rule died with `Cannot read rule directory .taskless/rules/sg/<other-id>/.tests` and exit 6, naming a rule the author had never touched. `--filter` does not scope that away, so there was no way to run one rule's tests around it.

`0005` now gives every `rules/sg/<id>/` a `.tests/`, holding a committed `.gitkeep` when it would otherwise be empty — git does not track empty directories, so without one the repair would not survive a commit and the failure would come back in CI. Assembly separately omits any `testDir` that is not on disk, which is what rescues a project a nightly already stamped at version 5: migrations short-circuit once the manifest is at the latest version, so those installs never re-run the amended `0005`, and the same state is reachable at any version by creating a rule directory by hand. Neither change turns a missing test into a pass — `verify` still reports "No test file found" and `test` still reports "Skipped: no test file found", both reading the rule directory rather than the generated config.
