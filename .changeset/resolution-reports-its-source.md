---
"@taskless/cli": patch
---

`resolvePlatformBinary` now reports which tier answered.

`PlatformBinaryResolution` gains `source` — `platform-package`,
`node_modules/.bin`, or `PATH`. Only the first is the pinned install, so only it
tells a caller the binary is the one this CLI ships.

The entry's documentation previously said to gate that on `isPlatformBinary`. It
cannot: that checks a file exists and answers `--version` as the right tool,
which every tier satisfies by the time a path is returned, so a second call is
always true. A consumer following the advice would have believed it had required
the pinned engine while a `PATH` binary of any version passed. The one consumer
this was written for had already worked that out and hand-rolled a prefix
comparison against a package root it derived itself, which is this resolver's
search order copied into another repository.

`tried` still names the actual package rather than the tier, because a failure
saying `platform-package` is less actionable than one naming something a user
can install.

Also adds a test that each engine version constant matches the
`optionalDependencies` pin that installs it. The existing vendor-contract tests
spawn each engine and assert `--version` matches the constant; neither is
sufficient alone, since those read the binary the pin installed and never look at
the pin. The constants are not published: a consumer wanting the pinned engine
reads `source`.

A third check closes the last link: each engine is spawned from **inside its
pinned platform package** and its `--version` compared to the constant. The
existing vendor-contract tests spawn whatever resolution returned, which is the
pinned package only when that tier wins, so they closed this by luck of ordering
rather than by asserting it. `source` is what lets the tier be required instead
of assumed.
