## 1. Delivery

- [x] 1.1 Write `rule restore` and `rule rollback` through `writePreparedRules`, reporting a write failure as `RULE_RESTORE_FAILED` and an unwritable served set as `RULE_RESTORE_MISMATCH`
- [x] 1.2 Remove the stale-entry branch, and `writeServedRule` and `writePreparedRule`, which nothing calls any more
- [x] 1.3 Test a restore and a rollback whose write fails, with the rule both new and replacing an older version, and a rollback over a version holding a read-only file
