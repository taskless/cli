---
"@taskless/cli": patch
---

Stamp a `self` build with the release it anticipates rather than the one it follows.

`build:self` reported the committed package version, so on a `main` carrying
unreleased work it wrote `install.cliVersion: "0.10.2"` into the committed
`.taskless/taskless.json`. That names a release predating the tree, and it is
indistinguishable from the value a real install of that release would write, so
the file silently lost whatever it held.

A self build now stamps `<next>-self`, where `<next>` is what the pending
changesets propose. The suffix names what the build anticipates rather than what
it follows, and it is unmistakable in a diff. It is safe for the reconciliation
ledger, which compares the numeric core, so `0.11.0-self` and `0.11.0` are the
same version to a walk, exactly as a nightly and its release are.

Only the `self` target changes. A prod build still reports the committed
version.
