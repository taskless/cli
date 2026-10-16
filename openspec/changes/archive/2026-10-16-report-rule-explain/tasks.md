## 1. Schema and assembly

- [x] 1.1 Regenerate `src/generated/report-v1.schema.json` from tskl.es
- [x] 1.2 Require `explain` on every facts rule entry (local, legacy, cloud) and refuse a blank `title`
- [x] 1.3 Carry `explain` onto every published rule and add it to `ReportRule`
- [x] 1.4 Screen each rule's `explain` for redaction matches, naming the field

## 2. Recipe

- [x] 2.1 Ask for `explain` in the report recipe's facts step and add `## Explaining a rule`; bump the topic to v6

## 3. Tests

- [x] 3.1 Add `explain` to facts fixtures; test it is carried on every tier, required, bounded, and screened
