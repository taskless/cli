---
"@taskless/cli": patch
---

`rule create --json` and `rule improve --json` now emit the standard `{ ok:
false, code, message }` envelope on stdout when a file-set rule arrives with
a stray `tests` field, instead of throwing a bare, unreported `CLIError`.
Previously the guard threw from inside the command's own `try` without going
through the command's `fail()` helper, so under `--json` nothing was written
to stdout at all — prose landed on stderr and the process exited 1,
indistinguishable from a crash, and the `RULE_GENERATION_FAILED` code the
`create-remote-rule` recipe documents as a branch target was never actually
reachable for this guard. Both call sites now route through `fail()`, and the
duplicated guard itself was consolidated into one shared check so the two
copies cannot drift again silently.

Not addressed here: rules written to disk earlier in the same delivery loop
(before the guard fires) are still not named in the failure envelope. The
published envelope shape (`CLIErrorEnvelope`) has no field for a partial file
list, and adding one is a schema change out of scope for this fix.
