## 1. Spec

- [x] 1.1 Restate "Recovery suggestions follow the plan" in full as a MODIFIED
      block, keeping all six scenarios.
- [x] 1.2 Dry-run `openspec archive` and confirm every scenario survives.

## 2. Messages

- [x] 2.1 Migration 0005: move by hand, then run `init`.
- [x] 2.2 Git steps: `HEAD` for an uncommitted change, `<commit>~1` otherwise.
- [x] 2.3 `update --rules`: name `init`.
- [x] 2.4 Duplicate id: rename the local rule, and where its id appears.
- [x] 2.5 `check` recipe example and commit guidance; topic v6.

## 3. Tests

- [x] 3.1 Migration 0005 refusal names the hand move and `init`, not 0004.
- [x] 3.2 Verdict tests assert the new git steps.
- [x] 3.3 Reconcile-marker refusal names `init`.
- [x] 3.4 Duplicate-id failure names the local rule and each engine's places.
