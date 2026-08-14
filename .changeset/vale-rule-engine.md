---
"@taskless/cli": minor
---

Add Vale as a second static-tier rule engine, and give every engine one rule layout.

`check` now dispatches by engine and runs ast-grep, Vale, and runtime rules
concurrently, merging their findings into one result set. An unavailable Vale
reports itself and the other engines still return. A Vale that times out or
rejects its config fails the check rather than passing as a clean run.

**Every rule is now one directory**, `.taskless/rules/<engine>/<id>/`, holding
the rule, any per-engine config, and its tests in `.tests/`. Writing a rule
means creating a directory and deleting one means `rm -rf`. Nothing outside it
is touched either way, so concurrent authors never collide on a shared file.

Vale rules carry their own `.vale.ini` declaring which files they apply to.
The single config Vale reads is assembled from those per-rule files on each
run, gitignored, and regenerated, so hand edits to it have no effect. ast-grep
keeps its `files`/`ignores` inside the rule and needs no second file.

**`rule verify` is replaced by two path-addressed commands.** `verify <path>`
checks that a rule has the components its engine requires and needs no tests,
so it works while you're still authoring. `test <path>` runs the rule's tests,
after running `verify` and stopping if that fails. Both take a rule directory,
an engine directory, or nothing at all for the whole project, and both report
one result per rule. Addressing by path rather than id removes the ambiguity
that arose when two engines held the same rule id.

Agent recipes are rewritten for the layout, and `taskless agent route` now
carries the engine-selection reasoning that used to be its own topic.

Projects on an older layout migrate automatically on the next command.
