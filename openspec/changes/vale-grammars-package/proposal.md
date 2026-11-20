## Why

Vale 3.27.0 moved its tree-sitter grammars out of the binary and into WebAssembly modules that `vale sync` downloads. The CLI never runs `vale sync`, so on 3.27.0 Vale finds comments in source files by their delimiters instead of parsing them. Measured on PR #703, which moves the pins to 3.27.0 and fails 6 vendor-contract cases:

- linter directive comments (`//nolint`, `# noqa`, `// eslint-disable…`, `// ReSharper`, `// NOSONAR`) and a Python docstring's `:param:` lines are linted as prose: new false positives;
- a one-line CSS block comment (`/* … */`) is not linted at all: a new false negative;
- every run that touches a code file emits one `W101 grammar "<name>" is not installed` warning per language, which `check` surfaces as notices.

With the upstream grammars available through `VALE_GRAMMARS_PATH`, all 373 Vale tests pass on 3.27.0 unchanged. Shipping the grammars therefore turns a silent behavior change into no change at all.

## What Changes

- Publish one platform-independent package, `@taskless/vale-grammars`, carrying the grammar modules from the same upstream Vale release as the binaries. One package rather than a copy per platform package, so a grammar can never be one version on macOS and another on Linux.
- Pin the grammar archives' SHA256 digests in `.github/scripts/vale-manifest.json`. Upstream's `vale_<version>_checksums.txt` does not cover them, so the detect phase records the digests it downloads and the manifest pull request is where a human reviews them, the same trust boundary as the binaries.
- `vale-prepare.cjs` packs the grammar package beside the six platform packages, and `release-vale.yml` publishes all seven at one stamp. The first publish of the new name is a manual one by a maintainer, as npm trusted publishing requires, after which the trusted publisher is registered against the existing `release-vale.yml`.
- The CLI depends on `@taskless/vale-grammars` at an exact version whose Vale component matches the binary pins, and `vale-upgrade.yml` moves both pins together.
- Every Vale invocation sets `VALE_GRAMMARS_PATH` to the resolved grammar package directory. Vale reads that directory for any grammar the StylesPath lacks, one grammar at a time.
- A grammar directory inside the Vale rules tree (`.taskless/rules/vale/config/grammars/`, which Vale would read in preference to ours) is refused when the Vale config is assembled, so both `validate` and `check` reject grammars the CLI did not ship and pin.
- The runtime export (`@taskless/cli/node/runtimes`) publishes the grammar package spec and resolver beside `VALE_BINARY`, so a consumer that verifies Vale rules runs them with the same grammars the CLI does.
- A contract check fails when any comment-tier extension in `VALE_FORMAT_TIERS` needs a grammar the pinned package does not carry.

Not breaking. The bump is `patch`: users see 3.26.0's comment handling on 3.27.0.

## Delivery shape

**Two landings**, because a pull request cannot pin a package that is not on npm yet:

1. **PR A, single PR to `main`:** this proposal, the manifest's grammar section, packing, publishing, and the detect-phase digest recording. It changes no consumer and ships no release note. After it merges, a maintainer publishes `@taskless/vale-grammars` by hand and registers its trusted publisher.
2. **PR B, the lateral vendor-bump merge** (AGENTS.md, "Landing a machine-generated vendor bump"): cut from #703's head, targeting `main`. It carries the CLI pins, `VALE_GRAMMARS_PATH`, the rules-tree refusal, the runtime export, the coverage check, the `update` ledger entry, and the grown changeset. It may be a stack if the review size calls for one. It archives this change and supersedes #703.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `vale-binary-packages`: adds the grammar package, its committed digests, and its release beside the platform packages.
- `cli-vale-rule-engine`: Vale reads code with the pinned grammars, and a grammar directory in the rules tree is refused.
- `cli-runtime-binary-export`: the grammar package spec and resolver are published beside the binary resolver.

## Impact

- `.github/scripts/vale-manifest.json`, `vale-detect.cjs`, `vale-release.cjs`, `vale-prepare.cjs`, `vale-gate.cjs` and their tests; `.github/workflows/release-vale.yml`, `vale-upgrade.yml`.
- New `packages/vale-grammars/` (metadata only; modules are placed by the pipeline and never committed).
- `packages/cli`: `package.json` dependency, `src/rules/vale/run.ts` (spawn environment), `src/rules/vale/binary.ts` or a sibling grammar resolver, `src/rules/assemble.ts` (refusal), `src/node/runtimes/index.ts`, `src/agent/update.md`, the vendor-contract and engine-version-consistency tests.
- Install size: about 15 MB compressed for the grammar package, once per install regardless of platform.
- Manual, one time: the first publish of `@taskless/vale-grammars` and its trusted-publisher registration.
