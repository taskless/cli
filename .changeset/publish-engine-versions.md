---
"@taskless/cli": patch
---

`@taskless/cli/node/runtimes` now publishes `AST_GREP_VERSION` and
`VALE_VERSION`, so a consumer can know which engine it should have without
spawning one.

That is the point of publishing them. A service verifying generated rules in a
sandbox should not have to shell out to `--version` to decide whether it trusts
the resolution, and the entry's own documentation previously told it to.

A published number a consumer trusts has to be checked here, in two links. A new
test asserts each constant matches the `optionalDependencies` pin that installs
it, statically. The existing vendor-contract tests spawn each engine and assert
its `--version` matches the constant. Neither is sufficient alone: the execution
tests read the binary the pin installed and never look at the pin, and the static
test would pass while the shipped binary disagreed with both.

The resolver's contract is unchanged, and the doc is now explicit that a
resolution can come from `PATH` and be any version. `isPlatformBinary` is how a
consumer requires the pinned package, and a consumer that does is entitled to the
published version without running anything.
