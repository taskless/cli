## 1. One finding schema

- [x] 1.1 Declare `findingSchema` once in `schemas/finding.ts`
- [x] 1.2 Use it for `check --json`'s `results[]`, and extend it with `bucket` for `verify`'s fixture findings
- [x] 1.3 Publish `findingSchema` and `checkOutputSchema` from `@taskless/cli/schemas`

## 2. Per-rule summary

- [x] 2.1 Add `summarizeFindings`, grouping by engine and rule id, and the `summary` schema
- [x] 2.2 Emit `summary` on every `check --json` run, early returns included
- [x] 2.3 Add `--summary`: omit `results` under `--json`, print per-rule counts in text mode

## 3. Docs

- [x] 3.1 Document `summary` and `--summary` in the `check` recipe (topic v10) and the README

## 4. Tests

- [x] 4.1 Unit-test `summarizeFindings`: empty, ordering, file spellings, one id under two engines, an unmapped source
- [x] 4.2 Assert `summary` and `--summary` end to end, in JSON and text, and on a project with no rules
- [x] 4.3 Parse a finding from the built `check --json` and one from `verify --json` against the one published `findingSchema`
