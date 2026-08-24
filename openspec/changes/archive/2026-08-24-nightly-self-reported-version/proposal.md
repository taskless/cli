## Why

A nightly reports the version of the release it anticipates, not the version
it is. Installing `@taskless/cli-nightly@0.11.0-20260823220841xd9dee3d` writes
`install.cliVersion: "0.10.2"` into `.taskless/taskless.json`, while the skills
emitted beside it — in the same run, by the same build — pin every command to
the nightly's exact version.

The cause is an ordering the nightly design chose deliberately. The version is
stamped when the publishable artifact is produced, and the committed manifest
is left alone; but `__VERSION__` is baked from that committed manifest at build
time. So `package.json` is asked a question it cannot answer, and it answers
confidently with the previous release.

This is quiet rather than loud, which is what makes it worth fixing. Nothing
errors. The manifest simply attributes the install to a version that never
performed it — and `install.cliVersion` exists precisely to answer "what
installed this?", which is the question asked when a nightly is being used to
reproduce unreleased behavior.

## What Changes

- **A build reports the version it is published as.** `resolveCliVersion`
  returns the stamped nightly version for the `nightly` target and the
  committed package version for every other, and the build's `__VERSION__`
  define reads it instead of `package.json` directly.
- **The refusal matches the invocation's.** A `nightly` build with no stamp
  throws rather than falling back, reusing `resolveNightlyVersion`. The
  plausible fallback is the wrong answer that produced this bug.
- **Nothing else moves.** The committed manifest is still untouched by a
  nightly build, which the existing requirement demands.

This corrects `taskless --version`, the `%(CLI_VERSION)s` recipe header, the
`cliVersion` telemetry property, and `install.cliVersion` — all four read the
same define.

**Delivery is a single PR.** One pure function, its call site, tests, and a
spec delta.

## Capabilities

### Modified Capabilities

- `cli-nightly-builds`: a nightly reports its own published version as its CLI
  version, rather than the released version its committed manifest declares.

## Impact

- **Modified**: `packages/cli/scripts/build-target.ts` (new `resolveCliVersion`),
  `packages/cli/vite.config.ts` (the `__VERSION__` define),
  `packages/cli/test/build-target.test.ts`.
- **Unchanged**: `packages/cli/package.json`, and `.github/scripts/nightly-pack.cjs`
  — the stamp is already computed once and already passed to the build as
  `TASKLESS_NIGHTLY_VERSION`. This change consumes a value that was already
  there rather than plumbing a new one.
- **Unchanged**: the `assert-skill-versions` build check, which compares skill
  frontmatter against the committed `package.json`. That is a claim about
  source files in the repository, not about what a build reports, and a nightly
  must not rewrite it.
- **Not fixed retroactively**: manifests already written by a nightly still
  record the anticipated release. The next install corrects them.

**Tracking:** taskless/cli#148
