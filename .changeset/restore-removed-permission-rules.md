---
"@taskless/cli": patch
---

`taskless init` now puts back a Taskless allow rule that was removed from a harness permission file (`.claude/settings.json`, `.cursor/cli.json`, and the rest) by a hand edit, a revert, or a merge. Previously the install trusted its own record over the file, so a removed rule stayed removed and the wizard showed no edit. A permission file that was deleted is recreated with the rule.
