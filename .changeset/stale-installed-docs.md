---
"@taskless/cli": patch
---

The installed `.taskless/README.md` and Taskless skill no longer describe a
layout two migrations old.

Both named `rule-tests/`, a directory `0005` deletes, and the README described
rules as living under `sg/rules/` and `vale/rules/` rather than the current
`rules/<engine>/<id>/`. The skill line is the one that mattered most: it is a
trigger description, so it taught an agent to look in a directory the migration
had removed.

`0001` writes the README on every run and says it "overwrites stale content
from older versions", which is true and not sufficient. Migrations only run
above the recorded version, so a project already at 5 never ran `0001` again
and kept its stale copy permanently. Migration `0006` rewrites it, so an
existing project gets a correct description rather than only new installs.

The README's layout section is now derived from the rule layout table instead
of described beside it, so the words cannot disagree with the directories they
describe. `LATEST_SCHEMA_VERSION` is exported for the same reason: tests
hardcoded the current version in ten places, and the version matrix listed
prior versions literally, so each new migration silently stopped covering the
version it had just made prior.
