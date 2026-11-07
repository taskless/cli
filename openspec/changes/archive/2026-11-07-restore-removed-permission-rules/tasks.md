## 1. Fix

- [x] 1.1 Compute the rules to add from the file's Taskless rules, not the manifest record
- [x] 1.2 Record a recreated file as created by Taskless, and never list a rule twice in the record

## 2. Tests

- [x] 2.1 For every harness: a recorded rule missing from the file is added back and reported
- [x] 2.2 For every harness: a deleted recorded file is recreated with the rule
- [x] 2.3 For every harness: a record and file that agree produce no edit
