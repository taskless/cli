## 1. Spec

- [x] 1.1 ADDED requirement for the not-verified notice; MODIFIED "Check
      selects what it runs from auth state" and "Check accepts --anonymous as
      a no-op", each restated in full.
- [x] 1.2 Dry-run `openspec archive` and compare the scenario count in
      `cli-check` before and after.

## 2. Implementation

- [x] 2.1 `plan-check.ts`: one notice per unverified plan, with cause and
      remedy, regardless of runtime rule count.
- [x] 2.2 Name the specific remote problem from the `CLIError` code.
- [x] 2.3 Extract `orgNotFoundRemedy()` from `orgNotFoundMessage()` and use it
      for `organization_not_found` in `check`.
- [x] 2.4 `check` recipe topic v6.

## 3. Tests

- [x] 3.1 Logged out with and without runtime rules, human and `--json`.
- [x] 3.2 `--anonymous`, the three remote problems, `organization_not_found`.
- [x] 3.3 Tests that asserted `notices` absent on a clean logged-out `--json`
      run now assert the not-verified notice is the only one.
