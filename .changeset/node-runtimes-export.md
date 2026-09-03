---
"@taskless/cli": patch
---

`@taskless/cli/node/runtimes` publishes the engine binary resolver.

It exports `resolvePlatformBinary` along with the `AST_GREP_BINARY` and
`VALE_BINARY` specs, so a service that verifies a generated rule can locate the
same ast-grep and the same Vale that `taskless check` executes, instead of
pinning the engine version by hand in a second place.

The second pin is the problem it removes. A generator sandbox pinned
`@ast-grep/cli` at 0.41.1 while this package pinned 0.45.2, and a capture that
narrows differently across those four minors verifies clean in the sandbox and
matches nothing on the machine that runs it — a rule that passes its gate and
never fires, with both sides reporting success. Installing this package and
asking it where the binary is makes the engine version a consequence of the CLI
pin rather than a fact tracked alongside it.

`node/` is in the specifier because resolution spawns each candidate to make it
identify itself, reads the filesystem, and consults `PATH`. `/prompts` and
`/layout` remain host-free and a Worker still imports them; the build now
requires every published export to declare which of the two it is, so this
entry's exemption is written down rather than inferred from a missing list
entry.

Resolution still reports a miss as `{ path: undefined, tried }` rather than
throwing. That is what lets `check` lose one engine instead of the whole run,
and it is why a verifier should fail closed on `undefined` itself: a sandbox
whose optional dependency did not install resolves nothing for the same reason a
laptop does, and skipping verification there reports a clean generation for a
rule nothing checked.
