---
"@taskless/cli": patch
---

`check`, `verify` and `test` no longer migrate `.taskless/` as a side effect of
reading it.

Migration `0005` moves and deletes tracked files, and these three commands
performed it on the way to doing their real work. So a command whose whole job
is to report rewrote the repository, with nothing on the human path to say so:
the diff landed in whatever commit came next, and in CI it ran on every
checkout.

It also made a migration impossible to verify. Comparing findings before and
after cannot be done when asking the question performs the change, so a
migration that silently dropped a rule could not be caught by the one check
that would catch it.

These commands now refuse a project whose scaffold is behind, name
`taskless init` as the fix, and leave the working tree untouched. The refusal
carries `SCAFFOLD_MIGRATION_REQUIRED` on the `--json` envelope, distinct from
the existing `SCAFFOLD_VERSION_MISMATCH`, which is the opposite direction and
asks the caller to upgrade the CLI instead.

The cost is a wall the user meets once after an upgrade, where before they met
nothing. That is the visible version of the same event.

`init --json` is new, and carries the `migrated` field that `check`, `verify`
and `test` used to report. The field followed the behaviour rather than being
dropped: a CI script still needs to know the working tree was rewritten and
what moved. It is gone from those three envelopes, where it can no longer
occur; it was always optional and conditional, so nothing that read it
correctly breaks.
