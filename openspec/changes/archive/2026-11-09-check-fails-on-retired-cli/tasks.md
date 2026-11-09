## 1. Policy

- [x] 1.1 Add a failure when reconcile answers `upgrade_required`, leaving `unavailable` and the other outcomes non-fatal
- [x] 1.2 Say in the `ci` recipe that a retired CLI version fails CI, and bump its topic version

## 2. Tests

- [x] 2.1 `check`: a `cli_upgrade_required` answer exits 1, fails with the version message, and the notice names the upgrade command
