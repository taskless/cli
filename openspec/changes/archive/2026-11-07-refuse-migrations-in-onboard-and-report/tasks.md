## 1. Refuse instead of migrating

- [x] 1.1 `onboard` calls `requireCurrentSchema` before `ensureTasklessDirectory`, in every mode
- [x] 1.2 `report` calls `requireCurrentSchema` before `ensureTasklessDirectory`, in every mode, through its existing error path

## 2. Tests

- [x] 2.1 Cover a behind scaffold for every mode of both commands, `report --json`, an ahead scaffold, and a project with no `.taskless/`
