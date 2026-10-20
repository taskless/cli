## 1. Build-time lockfile

- [x] 1.1 Add a build step for nightly and release targets that walks the CLI importer's production dependencies through `pnpm-lock.yaml` (`yaml` is already a dev dependency) and emits a version 3 npm lockfile: root, the CLI entry without `integrity`, and every dependency flat with `resolved`, `integrity`, `os`, `cpu`, `optional` and `dependencies`; embed it in the bundle; emit none for `self`; verify with a unit test over a fixture lockfile
- [x] 1.2 Fail the build when a name appears at two versions in the walk, or a package has no integrity; verify with fixture tests that each failure names the package
- [x] 1.3 Verify against the real tree: build the release target, write the lockfile into a scratch directory with its one-line `package.json`, run `npm ci --ignore-scripts`, and confirm `tsx`/`esbuild` match `pnpm-lock.yaml` and only this platform's binaries are installed

## 2. Init

- [x] 2.1 Write `.taskless/bin/cli.lock.json` or `cli-nightly.lock.json` with the launcher, unchanged/created/restored like the launcher, never touching the other package's; verify with tests for a release install, a nightly beside a release, and an edited lockfile
- [x] 2.2 Prune `.taskless/.cache/` after recording versions (shared rule in `src/install/launcher.ts`; the template keeps its own copy since it ships standalone); verify with tests that an upgrade drops the old release and a nightly install keeps it

## 3. Launcher

- [x] 3.1 Run from the cache: resolve `.taskless/.cache/<package>@<version>/`, read the bin from the installed `package.json`, run it with `process.execPath` and no shell; verify a pre-populated entry runs and no `npm` process starts
- [x] 3.2 Refuse without a matching lockfile: missing, or naming another version; verify each with a test (no `npm` started, message names the lockfile and the installer command)
- [x] 3.3 Install: temporary directory, one-line `package.json` plus the lockfile, the nearest `.npmrc` at or above the project root copied in (not `npm prefix`, whose output masks UUID-like path segments), `npm ci --ignore-scripts --no-audit --no-fund --loglevel=error` with output on standard error, remove the `.npmrc`, check the bin resolves, rename (discarding ours on a lost race); `cmd.exe` quoting only for the npm calls; verify first run, second run, lost race and clean `--json` output with a stub `npm` on `PATH`
- [x] 3.4 Failure paths: npm missing, npm exiting non-zero, bin missing; each removes the temporary directory and exits non-zero naming `<package>@<version>`; verify with tests
- [x] 3.5 Write `.taskless/.cache/.gitignore` (`*`); verify with a test and `git status` in a scratch repository
- [x] 3.6 Prune after a new install by the shared rule, ignoring removal errors; verify with tests for an upgrade and for keeping the other package's entry

## 4. Recipes and skill

- [x] 4.1 `ci` recipe: `actions/cache` for `.taskless/.cache` keyed on `runner.os` and `hashFiles('.taskless/bin/cli.lock.json')`, the same advice in the other-CI guidance, topic version bump; verify with the recipe tests
- [x] 4.2 `hooks` recipe and `skills/taskless/SKILL.md`: the first run of a version installs it into `.taskless/.cache/`, later runs are local; the lockfile is committed with the launcher; verify the parity tests (no prettier over `src/agent/*.md`)

## 5. Verification and release

- [x] 5.1 End to end from a built release-target CLI in a scratch project: `init` writes launcher and lockfile; `./.taskless/bin/cli.mjs check` runs an ast-grep and a Vale rule, and a runtime rule if available; the second run starts no `npm`; `git status` shows the lockfile and not the cache. Since the version under test is unpublished, serve it from a local scoped registry as in the design's measurements
- [x] 5.2 Private registry: a project `.npmrc` pointing at an unreachable registry fails the first install with npm's error and leaves no `.npmrc` or temporary directory
- [ ] 5.3 Extend `.changeset/pinned-cli-wrapper.md` (no second changeset); update #538 with the shrinkwrap measurements and point it at this change
- [ ] 5.4 Run `pnpm typecheck`, `pnpm lint` and the test suite
- [ ] 5.5 Archive and check scenario counts for `cli-project-launcher`, `cli-init` and `cli-agent` against the main specs
- [ ] 5.6 Follow-up, not blocking: a Windows run of a first install and a later run
