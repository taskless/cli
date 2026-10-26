---
"@taskless/cli": patch
---

Every rule's fixtures are now case directories under `tests/` for every engine: `tests/pass/<case>/` and `tests/fail/<case>/`. `taskless verify` runs each case through the engine's own check, with the case directory as its root, so ast-grep `files:`/`ignores:` and a Vale rule's `.vale.ini` matchers apply to fixtures the same way they apply to your code. A fixture that only passed because the old runner ignored scope now fails, and the failure says the scope excluded it. ast-grep `valid:`/`invalid:` test YAML and `sg test` are no longer used.

Run `taskless init` once to migrate. Migration 12 converts `.tests/` into the new layout: each ast-grep snippet becomes its own case, at a path the rule's scope admits, and each Vale document becomes a case named for it. It leaves anything it cannot convert in place and names it. The scaffold version moves to 12, so an older pinned CLI refuses a migrated project with `SCAFFOLD_VERSION_MISMATCH` until it is upgraded. A rule served in the old `.tests/` layout is converted as it is written, so nothing depends on the service changing. The `reference.json` corpus moves to version 4.
