## 1. One classifier, one policy switch

- [x] 1.1 Add `SchemaState` and `classifySchema(cwd)` to `filesystem/migrate.ts`, keyed on the directory
- [x] 1.2 Build the ahead and behind refusals once (`schemaAheadError`, `schemaMigrationRequiredError`); `runMigrations` uses the former
- [x] 1.3 Add `SchemaPolicy` and `ensureSchema(cwd, policy, options)` to `filesystem/directory.ts`
- [x] 1.4 Remove `requireCurrentSchema` and `pendingMigration`

## 2. Move every command onto `ensureSchema`

- [x] 2.1 `check` and `update --rules` use `refuse`
- [x] 2.2 `validate`, `verify`, `onboard` and `report` use `scaffold-if-absent`
- [x] 2.3 `init` (non-interactive) and the wizard use `migrate`
- [x] 2.4 `rule create`, `improve`, `restore` and `rollback` use `refuse`, before identity and the service call

## 3. Tests

- [x] 3.1 A table test over every (state × policy) pair, plus the override
- [x] 3.2 The rule-writing commands refuse a behind and an ahead scaffold and leave the tree unchanged
- [x] 3.3 Rule-command fixtures seed the current schema version instead of relying on a silent migration from version 0
