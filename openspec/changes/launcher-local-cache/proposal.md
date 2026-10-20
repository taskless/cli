## Why

The project launcher (#537) runs the CLI version recorded in `.taskless/taskless.json`, but every run still goes through `npx --yes <package>@<version>`. That puts npx's shared cache, its resolution rules and a registry lookup inside every Taskless command. It also leaves the CLI's own dependencies floating: a published package carries only its `package.json` ranges, so a fresh install of 0.13.1 on 2026-10-19 resolved `tsx` 4.23.15 and `esbuild` 0.28.x where we test 4.21.0 and 0.27.3 (#538).

A published `npm-shrinkwrap.json` cannot fix that for this package. Measured through a registry with npm 11.8: a full shrinkwrap installs every platform's ast-grep, Vale and esbuild binaries (1.0 GB instead of 110 MB), because npm unpacks a dependency's shrinkwrap without its platform check, and a shrinkwrap without the platform packages installs no binaries at all.

Installing the recorded version once into a git-ignored `.taskless/.cache/`, from a lockfile the release build derived from our own `pnpm-lock.yaml`, makes every run local and every install the tree we tested. npm is then only the download step, and the lockfile is committed in the project where a reviewer can read it.

## What Changes

- Each nightly and release build derives an npm lockfile for its own package from `pnpm-lock.yaml`, offline, and embeds it. The CLI's `package.json` keeps its ranges; development stays loose. A build whose dependency tree cannot be laid out as one flat npm tree fails rather than shipping a partial lockfile.
- `init` writes that lockfile beside the package's launcher, `.taskless/bin/cli.lock.json` for the release and `.taskless/bin/cli-nightly.lock.json` for the nightly. A nightly install leaves the release's pair alone, as it already leaves the release's launcher.
- The launcher installs into `.taskless/.cache/<package>@<version>/` with `npm ci --ignore-scripts` from its lockfile, into a temporary directory renamed into place once complete, then runs the installed bin with the same `node`. It no longer calls `npx`. A missing lockfile, or one that does not name the recorded version, stops the launcher with a message to rerun `init`.
- The install uses the project's `.npmrc`, the one `npx` would have read, so private registries keep working.
- The cache ignores itself (`.taskless/.cache/.gitignore` containing `*`). No scaffold migration.
- Cached versions neither package records are removed, by `init` and by the launcher after it installs a new version.
- The `ci` recipe caches `.taskless/.cache`, keyed on the runner OS and the hash of the package's lockfile.
- Not changed: `npx @taskless/cli` and `pnpm dlx` still resolve ranges. The launcher is the frozen path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-project-launcher`: the launcher installs from its lockfile into `.taskless/.cache/` and runs it there; published builds carry that lockfile; the cache ignores itself and drops unrecorded versions.
- `cli-init`: `init` writes the package's lockfile beside its launcher and prunes the cache.
- `cli-agent`: the `ci` recipe caches `.taskless/.cache` between runs.

## Impact

- `packages/cli/assets/launcher/launcher.mjs`: lockfile install and local run replace the `npx` call. The next `init` rewrites existing launchers and reports them restored.
- `packages/cli/vite.config.ts` (or a build script it calls): derive the lockfile from `pnpm-lock.yaml` for nightly and release targets, and fail the build when it cannot.
- `packages/cli/src/install/launcher.ts` and the `init` flow: write the lockfile, prune the cache.
- `packages/cli/src/agent/ci.md`, `packages/cli/src/agent/hooks.md`, `skills/taskless/SKILL.md`: cache step and first-run wording.
- Projects gain a committed lockfile per installed package (about 22 KB) and a git-ignored cache, about 110 MB per version on macOS arm64, at most one version per package. npm must be on `PATH` for each version's first run, as it already is for `npx`.
- #538 is resolved by this change rather than by pinning `tsx` in `package.json`.
- Delivery shape: single PR, stacked on #537, merging forward once #537 lands. It depends on the launcher and is safe on its own after it.
