---
"@taskless/cli": patch
---

Add `taskless demo runtime`, which writes an example runtime rule into the
project so the tier can be run, read and deleted rather than described.

The rule flags any `process.env` read whose key is not declared in the
repository-root `.env`. That subject is the point: deciding it needs the source
file and `.env` at once, which no single-file pattern can do, so the rule
exercises what distinguishes a runtime rule from an `sg` one.

It ships with the CLI rather than being generated, so it cannot arrive
mis-tiered or incomplete — CI runs its fixtures over the shipped bytes on every
change, and three mutation tests assert those fixtures still fail when they
should.

`check` will not execute it. A runtime rule runs only when an authenticated
reconcile returns its signature, and a locally written rule was never issued
one, so it is skipped with the reason `check` already gives. Running it uses the
documented `--dangerously-run-scripts`. No demo-specific bypass exists, and with
the rule written locally there is no demo identifier on the execution path that
one could key on.
