---
"@taskless/cli": patch
---

`verify` now fails a rule whose id is also a directory name under another engine, and a new scaffold migration (`9`) refuses to migrate a project that already holds one.

Two rules with the same id under two engines — `.taskless/rules/sg/no-eval/` beside `.taskless/rules/vale/no-eval/` — share one `.taskless/rule-metadata/no-eval.yml`, because the sidecar is keyed by id alone. The second `rule create` or `rule improve` overwrites the first's metadata silently, `rule meta <id>` returns the wrong rule's, and deleting either one takes the shared sidecar with it. None of that needed anyone to run `check`.

**If your project already has a collision**, the first `taskless init` after upgrading will refuse, naming both rule directories. Rename one of them — the directory, the rule file inside it, the rule's own `id:` field where its engine has one, and the `rule-metadata/<id>.yml` sidecar — then re-run `init`. Nothing is renamed for you on purpose: nothing in the CLI can tell which of the two rules should keep the id, and the sidecar, the rule's `.tests/` fixtures and the server-side id all reference the old name, so an automatic rename would break the references of whichever rule it moved.

`writeRuleFile` still writes through a collision and only warns, so `check`'s repair path is unaffected.
