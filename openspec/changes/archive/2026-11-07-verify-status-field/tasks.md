## 1. Status field

- [x] 1.1 Add `status` to `RuleVerification`, built by one constructor that derives `ok`, `ran` and `refused` from it
- [x] 1.2 Describe `status` in the `rule-check` schema as the field to branch on, verify-only
- [x] 1.3 Read `status` in `commands/verify.ts` and `report/draft.ts`

## 2. Recipes

- [x] 2.1 Name `status` in `validate-rule`, `create-sg-rule` and `create-vale-rule`

## 3. Tests

- [x] 3.1 Assert `ok`, `ran` and `refused` agree with `status` for all four outcomes
- [x] 3.2 Assert `status` end to end for a pass, a failure, a rule validate rejected, a refused runtime rule, and its absence from `validate`
