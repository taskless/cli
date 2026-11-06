## 1. Exit code

- [x] 1.1 Exit 2 from `verify` when no rule failed and a rule did not run, and keep exit 1 ahead of it
- [x] 1.2 Report top-level `ok: false` whenever the exit code is non-zero
- [x] 1.3 Update the `rule-check` schema descriptions

## 2. Recipes

- [x] 2.1 Document the exit codes in `validate-rule`
- [x] 2.2 Scope the pre-commit recipe in `hooks` to the static engine directories

## 3. Tests

- [x] 3.1 Cover a mixed run, a run with nothing verified, a failure beside a refusal, and the static engine paths
