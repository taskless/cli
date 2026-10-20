## Context

The launcher is a template, `packages/cli/assets/launcher/launcher.mjs`, rendered once per package and written to `.taskless/bin/cli.mjs` (release) or `.taskless/bin/cli-nightly.mjs` (nightly). It reads `install.launchers[<package>]` from `.taskless/taskless.json`, falls back to `install.cliVersion` when that version belongs to its package, and runs `npx --yes <package>@<version>`.

`@taskless/cli` does not run from its own tarball. It depends on `tsx` (a range), and through it on esbuild, `get-tsconfig` and esbuild's per-platform binary, and on seven ast-grep and six Vale per-platform optional packages (exact versions). Runtime rules run through that `tsx`.

Measurements behind the decisions below, all on 2026-10-19 with npm 11.8 on macOS arm64:

| Install                                                                                                | Result                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install @taskless/cli@0.13.1` into an empty prefix                                                | tsx 4.23.15, esbuild 0.28.x; only darwin-arm64 binaries; 110 MB                                                                         |
| Same, from a registry serving a repacked 0.13.1 with a full `npm-shrinkwrap.json`                      | tsx 4.21.0, esbuild 0.27.3, but every platform's binaries; 1.0 GB                                                                       |
| Same, shrinkwrap without the platform packages                                                         | tsx 4.21.0, no ast-grep, Vale or esbuild binary; 2.3 MB, broken                                                                         |
| `npm ci` from a constructed lockfile (deps from the pinned tree, CLI entry without `integrity`)        | tsx 4.21.0, esbuild 0.27.3, get-tsconfig 4.13.6; only darwin-arm64 binaries; 109 MB; 0.6 s                                              |
| `npm ci` with that lockfile and a `package.json` asking for another version                            | refused: `EUSAGE`, lockfile and `package.json` not in sync                                                                              |
| `npm config get registry` in a project with a `.npmrc`, with and without `--prefix .taskless/.cache/x` | the project's registry without `--prefix`; the public registry with it; the project's again once the `.npmrc` is copied into the prefix |

## Goals / Non-Goals

**Goals:**

- A launcher install is the dependency tree we tested, on every machine.
- After the first run of a recorded version, a Taskless command touches neither the network nor npm.
- The installed tree and the lockfile that produced it are inspectable inside the project.
- Private registries configured in the project's `.npmrc` keep working.
- The cache never holds more than the versions the manifest records.

**Non-Goals:**

- Freezing `npx @taskless/cli` or `pnpm dlx` installs. They keep resolving ranges.
- Changing the CLI's `package.json` at build or publish time.
- A cache shared across projects.

## Decisions

### The lockfile is derived from `pnpm-lock.yaml` at build time, offline

`pnpm-lock.yaml` is what CI installs and tests against, and it already holds what an npm lockfile needs: each package's `integrity`, its `os`, `cpu` and `optional` markers in `packages:`, and the resolved dependency graph in `snapshots:`. The nightly and release builds walk the CLI importer's production dependencies (`dependencies` and `optionalDependencies`) through `snapshots:` and emit a version 3 npm lockfile:

- `""`: `{ dependencies: { <package>: <version> } }`, the same one-line `package.json` the launcher writes.
- `node_modules/<package>`: version, registry `resolved` URL, and the package's own `dependencies`, `optionalDependencies`, `bin` and `engines`. No `integrity`: the lockfile ships inside this tarball, so it cannot hold the tarball's hash.
- `node_modules/<dep>` for every package in the walk, flat, with `resolved`, `integrity`, `os`, `cpu`, `optional` and `dependencies` from `pnpm-lock.yaml`.

The build fails if two packages in the walk share a name at different versions, since a flat layout cannot hold both and a nested one is a different problem to solve when it appears. It also fails if a package in the walk has no integrity in `pnpm-lock.yaml`. `yaml` is already a dev dependency of the CLI. The lockfile is embedded in the bundle as a string, the way recipes are, so `init` needs no file lookup and no network. A `self` build emits none.

`resolved` URLs name `registry.npmjs.org`. npm's default `replace-registry-host` rewrites that host to the configured registry, so a mirror still serves them.

Alternatives considered:

- **Publish an `npm-shrinkwrap.json`.** Measured above: 1.0 GB with platform packages, broken without them.
- **Rewrite `package.json` to exact versions at publish.** Rejected: the published manifest would differ from the repository's, and it would still leave transitive dependencies floating.
- **Resolve the lockfile at `init` time with npm, forcing the tested versions through overrides.** Needs the network at `init`, and npm's resolution, not our lockfile, decides the tree.

### One lockfile per package, beside its launcher

`init` writes `.taskless/bin/cli.lock.json` with `cli.mjs`, or `.taskless/bin/cli-nightly.lock.json` with `cli-nightly.mjs`, from the build that is running. It never writes the other package's pair. A lockfile whose bytes differ from this build's is rewritten and reported as restored, as the launcher is. Both files are committed, so an upgrade's dependency changes appear in the same diff as the version change.

### The launcher installs with `npm ci` into a temporary directory, then renames

On a cache miss the launcher:

1. Reads its lockfile. If it is missing, or its `node_modules/<package>` version is not the recorded version, it stops and says to rerun the installer. It never installs without the lockfile.
2. Creates `.taskless/.cache/.tmp-<pid>-<random>/`, writes `package.json` (`{ "private": true, "dependencies": { <package>: <version> } }`) and copies the lockfile in as `package-lock.json`.
3. Runs `npm prefix` from the project root and, if `<that prefix>/.npmrc` exists, copies it into the temporary directory.
4. Runs `npm ci --ignore-scripts --no-audit --no-fund --loglevel=error` there, with npm's output on standard error so a first run's `--json` output stays clean.
5. Deletes the copied `.npmrc`, checks the package's `bin` entry resolves, and renames the directory to `.taskless/.cache/<package>@<version>/`. If that already exists, another process won: it deletes its own directory and uses the existing one.

The final directory's existence means a complete install; there is no lock file. A failed step removes the temporary directory and exits non-zero without running the CLI.

`--ignore-scripts` is safe because every native piece arrives as a per-platform optional package; the measured install ran ast-grep, Vale and the CLI without scripts.

The run is `spawnSync(process.execPath, [entry, ...args])`, no shell. `cmd.exe` quoting stays only for the two npm calls on Windows, whose arguments are fixed.

### The cache ignores itself

The launcher writes `.taskless/.cache/.gitignore` containing `*` when it creates the directory or finds it without one. No migration, no edit to `.taskless/.gitignore`.

### Pruning

An entry is kept when it is `<package>@<version>` for a version `install.launchers` records (or the `cliVersion` fallback the launcher would use). Everything else goes, including `.tmp-*` directories older than an hour. `init` prunes after recording versions; the launcher prunes after it installs a new version, which covers a teammate who pulls an upgrade and never runs `init`. Removal failures (a locked file on Windows) are ignored and retried next time.

## Risks / Trade-offs

- [The CLI's own tarball has no `integrity` in the lockfile] → It is pinned by exact version, and a published npm version cannot be republished with different contents. Every dependency is hash-pinned.
- [A future dependency tree needs nesting (two versions of one package)] → The build fails, so a release cannot ship a wrong lockfile; nesting support is added when that happens.
- [`pnpm-lock.yaml` and npm disagree about a package's metadata] → The launcher's `npm ci` validates the lockfile on every first run, and the end-to-end check below runs it before release.
- [A concurrent run of an old version while the launcher prunes it] → Pruning follows only a new install, which follows a manifest change; the window is one run.
- [About 110 MB per project per package version] → At most one version per package after pruning.
- [npm missing on a first run] → Same requirement as `npx` today; the error names npm and the version.
- [CI cache restored from another OS] → The key includes the runner OS, and the launcher trusts an entry only when its bin resolves.

## Migration Plan

The next `init` rewrites each launcher and writes its lockfile, both reported. Until then a #537 launcher keeps using `npx`. A new launcher without its lockfile (a manifest from before `install.launchers`) stops and asks for `init`. Rolling back is reinstalling the older CLI; a leftover `.taskless/.cache/` and lockfile are harmless and safe to delete.
