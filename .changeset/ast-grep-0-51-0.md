---
"@taskless/cli": patch
---

Update the bundled ast-grep to 0.51.0 (from 0.45.3).

What a rule author sees:

- **Haskell rules on `kind: type_synomym` are renamed to `kind: type_synonym`.** ast-grep's Haskell grammar fixed the typo in that kind name, and a rule still using the old spelling fails to load. Because `taskless check` loads every ast-grep rule together, `check` would report the failure and no ast-grep findings at all. `taskless update --rules` now applies the rename itself when it records a reconciliation, naming each file it rewrote. No other Haskell kind or field changed.
- `taskless update --rules` applies mechanical rule rewrites for the engine versions a project's rules cross, keyed on the engine versions it last recorded rather than on the `.taskless/` layout version, so they never force a scaffold bump. `taskless update --json` lists them in advance. It now refuses with `SCAFFOLD_MIGRATION_REQUIRED` when the layout is behind; run `taskless init` first.
- `sg` rules can target `Zig`.
- A rule file ending in a stray `---` no longer stops `taskless check` from reporting any ast-grep findings for the project. ast-grep used to read the empty document after it as a broken rule and abort the whole scan. `taskless validate` still flags the file as multi-document YAML.
- The `.taskless/` layout does not change, so a pinned CLI keeps reading the project.
