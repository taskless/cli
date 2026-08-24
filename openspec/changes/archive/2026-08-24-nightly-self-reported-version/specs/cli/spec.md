## MODIFIED Requirements

### Requirement: CLI version is injected at build time

The CLI's `vite.config.ts` SHALL use the Vite `define` option to replace a `__VERSION__` sentinel with the version the build reports as its own, resolved at build time. For every build target but `nightly` that is the version string in `packages/cli/package.json`. A `nightly` is the exception, because its version is stamped when the publishable artifact is produced and the committed manifest is deliberately left unchanged, so `package.json` names the release the nightly anticipates rather than the nightly itself (see the `cli-nightly-builds` capability). No runtime file reads or import assertions SHALL be used for version resolution.

#### Scenario: Build replaces version sentinel

- **WHEN** `pnpm build` is run in `packages/cli/`
- **THEN** all occurrences of `__VERSION__` in source code SHALL be replaced with the literal version string from package.json

#### Scenario: A nightly build replaces the sentinel with its own stamped version

- **WHEN** a `nightly` build is run
- **THEN** `__VERSION__` SHALL be replaced with the version the nightly is published under, not the version in package.json
