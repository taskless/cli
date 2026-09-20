## Why

`taskless detect` recognizes eslint, biome and stylelint for JavaScript and TypeScript, but not oxlint. A repo that has moved to oxlint reports no JS linter, so `detect` output and everything downstream that reads it (`init`, the `route` recipe) treats the project as unlinted. oxlint is where a growing share of JS repos are heading for the static tier, and its plugin architecture cannot do cross-file rules, which makes an oxlint repo exactly the kind of project where Taskless runtime rules add something the linter cannot. Detect needs to see it.

## What Changes

- A new `oxlint` entry in `LINTER_SIGNALS` (`packages/cli/src/detect/scan.ts`), shaped like `biome`: languages JavaScript + TypeScript, config files `.oxlintrc.json`, `.oxlintrc.jsonc`, `oxlint.config.ts`, `oxlint.config.mts`, dependency `oxlint` matched against `package.json` only.
- The config list is the set oxlint auto-discovers per https://oxc.rs/docs/guide/usage/linter/config.html ("Oxlint automatically looks for a `.oxlintrc.json`, `.oxlintrc.jsonc`, `oxlint.config.ts`, or `oxlint.config.mts` in the current working directory"). `oxlint.config.{js,mjs,cjs}` are accepted only through an explicit `-c` flag and are deliberately excluded.
- The `cli-detect` spec's example list for "Linter configs are detected from disk" names `.oxlintrc.json`, and a scenario covers oxlint from either signal.
- Tests: `.oxlintrc.json` alone detects oxlint; `oxlint` only in `devDependencies` detects oxlint; an eslint-only repo does not report oxlint.

Nothing here is **BREAKING**. Pre-1.0, an added linter signal is a `patch`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-detect`: the "Detect scans deterministic repo signals only" requirement's example config list gains `.oxlintrc.json`, and a new scenario states that oxlint is detected from its config file or its `package.json` dependency.

## Impact

- `packages/cli/src/detect/scan.ts`: one new `LinterSignal` entry.
- `packages/cli/test/detect.test.ts`: three new cases.
- `packages/cli/src/agent/detect.md`: untouched; it does not enumerate the JS linters.

## Delivery shape

**Single PR.** The change is one signal entry, its tests, the spec delta and the archive; it fits one reviewable diff and is safe in production on its own.
