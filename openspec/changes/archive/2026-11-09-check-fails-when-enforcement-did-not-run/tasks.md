## 1. Policy

- [x] 1.1 Send a runtime rule's `unsafe` verdict to `failures` instead of `notices`, and update the policy table in `verdicts.ts`
- [x] 1.2 Add a failure when reconcile answers `unauthorized`, leaving `unavailable` and the other outcomes non-fatal
- [x] 1.3 Say in the `ci` recipe that a rejected token fails CI and an unreachable service does not

## 2. Tests

- [x] 2.1 `applyVerdicts`: an unsafe runtime rule fails and names the recovery, with and without rule recovery in the plan
- [x] 2.2 `check`: an edited runtime rule exits 1, a rejected token exits 1, an unavailable service still exits 0
