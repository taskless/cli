---
"@taskless/cli": patch
---

A nightly now reports the version it is, not the release it anticipates.

Installing a nightly wrote the previous release into `.taskless/taskless.json`
— `install.cliVersion: "0.10.2"` — while the skills written beside it, by the
same command in the same run, pinned every invocation to
`@taskless/cli-nightly@0.11.0-…`. The manifest attributed the install to a
version that never performed it, which matters because `install.cliVersion` is
what answers "what installed this?", and that question gets asked precisely
when someone is running a nightly to reproduce unreleased behavior.

A nightly's version is stamped when the publishable artifact is produced, and
the committed `package.json` is deliberately left untouched — so the build was
reading a file that could not know the answer. It now takes the same stamp that
names the published package, so the version a nightly reports and the version
it sends an agent to are the same string by construction.

This also corrects `taskless --version`, the CLI version in recipe headers, and
the `cliVersion` telemetry property on nightly builds. Released builds are
unaffected. A nightly that cannot determine its own version now fails the build
rather than quietly reporting the released one.

The build now also refuses to emit a nightly whose reported version and
embedded invocation disagree. Both derive from the same stamp, so they cannot
diverge today — but that was true of the two values in this bug as well, right
up until one of them started reading `package.json` instead. Deriving from one
source is not the same as being checked against it.
