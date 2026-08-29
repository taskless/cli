---
"@taskless/cli": patch
---

Stop a nightly from writing a `.taskless/README.md` that sends the reader to
the released package.

`.taskless/README.md` is written into the user's repository and overwritten on
every migration run, so what it names is shipped content. It hardcoded
`@taskless/cli@latest`, which meant a nightly wrote a README instructing its
reader to install the release over the nightly they had installed minutes
earlier to exercise unreleased behavior.

The obvious repair was not available. `applyCliInvocation` rewrites
`npx @taskless/cli` and `npx @taskless/cli@latest` and nothing else, and the
README shows two launchers, so routing it would have corrected the `npx` line
and left the `pnpm dlx` line naming the release. One right line beside one
wrong one is worse than two consistently wrong ones, because it looks fixed.

So the two halves of the answer are now handled separately, which is how
`util/package-manager.ts` already frames it. The **specifier** is a build-time
fact and was the whole bug: it comes from `pinnedSpecifier()` and is applied to
both launchers, so a nightly names `@taskless/cli-nightly` at its own version
on the `pnpm dlx` line and the `npx` line alike. The **launcher** is a runtime
fact and stays a menu in every build. This file is read long after it is
written, by someone who may reach for either package manager, and detecting the
launcher would make its bytes depend on how one particular run happened to be
launched, in a file many projects commit and the migration rewrites every time.
A `self` build, whose invocation is a path that no launcher fronts, gets that
one invocation instead of a menu. A released build's README is byte-identical
to before.

The `agent` topic index carried the same defect in its human-facing hint and is
now routed through `applyCliInvocation`, which is all that line needs.

Third time for this defect class, so it also gains a lint rule of its own.
`no-unrouted-cli-invocation` reports a string literal under `packages/cli/src/`
that names the released package outside a call to `applyCliInvocation`. It sits
on source rather than on the build output because nothing about the artifact
distinguishes routed content from unrouted content: a prod build legitimately
contains every one of these strings, and the rewrite happens at runtime.
