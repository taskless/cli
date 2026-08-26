---
"@taskless/cli": patch
---

Report the `.taskless/` layout migration on the `--json` envelope.

`check`, `verify`, and `test` migrate the scaffold before they can do their real
work, and that rewrites files in the working tree: rules move into per-rule
directories, configs are deleted, `taskless.json` and `.gitignore` are rewritten.
Until now the only trace was one line of prose on stderr, so a CI script reading
`{"success":true}` had no way to learn that its checkout had changed underneath
it. The migration would then land in an unrelated commit, or run mid-suite and
fail tests that had nothing to do with the change being made.

Those commands now carry a `migrated` field when, and only when, a migration
ran:

```json
{
  "success": true,
  "results": [],
  "migrated": {
    "from": 3,
    "to": 5,
    "applied": [4, 5],
    "files": {
      "added": [".taskless/rules/sg/no-eval/no-eval.yml"],
      "modified": [".taskless/taskless.json"],
      "removed": [".taskless/sgconfig.yml"]
    }
  }
}
```

The field is absent when nothing happened, so presence is the signal and no
consumer has to read empty arrays to decide. Paths are relative to the project
root and sorted.

The migration keeps happening automatically, because these commands need a known
layout to run at all and the alternative is a hard failure on every upgrade. The
human notice improved to match the new field: it names the source and target
versions up front, and prints the files it touched on completion.
