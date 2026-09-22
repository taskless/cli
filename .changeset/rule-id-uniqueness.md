---
"@taskless/cli": patch
---

Two rules can no longer share an id across engines. `verify` fails a rule whose id is also a directory name under another engine, and a new scaffold migration (`9`) renames the ones that already exist.

`.taskless/rules/sg/no-eval/` beside `.taskless/rules/vale/no-eval/` was silent: `check`'s human output prints `error[no-eval]` with no engine, so a collision shows two identical lines, and every id-addressed command had two answers to choose between.

**Your rule ids may change on upgrade, and `check` output changes with them.** The first `taskless init` after upgrading renames every colliding copy to `<id>-<engine>` — `sg/no-eval` becomes `sg/no-eval-sg`, `vale/no-eval` becomes `vale/no-eval-vale`. The rename is symmetric on purpose: no engine keeps the bare id, so nobody has to work out which of their two rules silently kept the name. If `<id>-<engine>` is already taken it uses the next free `<id>-<engine>-2`, `-3`, … and never overwrites an existing rule.

Everything the rename touches is inside the rule's own directory: the directory name, the rule file, its `id:` field, an sg rule's `.tests/` fixtures and their `id:` fields, and a Vale rule's `.vale.ini` breadcrumb and both segments of its `<id>.<id>` assignment. Every rename is printed — old path, new path, and each file rewritten — so you can see exactly what moved before committing it. Update any CI config, baseline file or suppression comment that names an old id.

`.taskless/rule-metadata/<id>.yml` is left where it is rather than following either rule, since a symmetric rename gives it no owner. In practice there is nothing there: this CLI has never written a sidecar, because the service does not return the metadata block they are written from.
