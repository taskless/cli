# CLI

## Purpose

TBD — Defines the structure and build requirements for the `@taskless/cli` package.

## Requirements

### Requirement: CLI package exists at packages/cli

The `@taskless/cli` package SHALL exist at `packages/cli/` with its own `package.json` declaring the package name `@taskless/cli`.

#### Scenario: Package is discoverable by pnpm workspace

- **WHEN** `pnpm-workspace.yaml` declares `packages/*`
- **THEN** pnpm SHALL resolve `@taskless/cli` as a workspace package at `packages/cli/`

### Requirement: CLI has a bin entry point

The package SHALL declare a `bin` field in `package.json` pointing to the built output. The built file SHALL include a Node.js shebang (`#!/usr/bin/env node`).

#### Scenario: CLI is executable via npx

- **WHEN** a user runs `npx @taskless/cli`
- **THEN** Node.js SHALL execute the bin entry point

#### Scenario: CLI is executable via pnpm dlx

- **WHEN** a user runs `pnpm dlx @taskless/cli`
- **THEN** Node.js SHALL execute the bin entry point

### Requirement: CLI builds with Vite

The CLI SHALL use Vite in library mode to produce a single bundled ESM output file. The build configuration SHALL live in `packages/cli/vite.config.ts`. The Vite build SHALL embed skills from `skills/`, commands from `commands/taskless/`, and agent recipe files from `packages/cli/src/agent/` via `import.meta.glob` with raw file imports. The build SHALL assert that every embedded skill's `metadata.version` matches the CLI's `package.json` version, failing with an error if any mismatch is detected.

#### Scenario: Build produces executable output

- **WHEN** `pnpm build` is run in `packages/cli/`
- **THEN** Vite SHALL produce a single file in `dist/` that is a valid Node.js ESM module with a shebang

#### Scenario: Build embeds skills from skills directory

- **WHEN** `pnpm build` is run in `packages/cli/`
- **THEN** every `SKILL.md` file under `skills/` at the repo root SHALL be embedded in the output bundle

#### Scenario: Build embeds commands from commands directory

- **WHEN** `pnpm build` is run in `packages/cli/`
- **THEN** every `.md` file under `commands/taskless/` at the repo root SHALL be embedded in the output bundle

#### Scenario: Build embeds agent recipe files

- **WHEN** `pnpm build` is run in `packages/cli/`
- **THEN** every `.txt` file under `packages/cli/src/agent/` SHALL be embedded in the output bundle

#### Scenario: Build fails on version mismatch

- **WHEN** any embedded SKILL.md has a `metadata.version` that differs from `packages/cli/package.json` version
- **THEN** the Vite build SHALL fail with an error identifying the mismatched skill(s)

### Requirement: CLI TypeScript config extends base

The CLI SHALL have a `packages/cli/tsconfig.json` that extends `../../tsconfig.base.json`. It SHALL add any CLI-specific compiler options without duplicating base settings.

#### Scenario: Type checking passes independently

- **WHEN** `pnpm typecheck` is run in `packages/cli/`
- **THEN** `tsc` SHALL pass with no errors using the extended config

### Requirement: CLI stub entry point

The CLI entry point SHALL use citty to define a main command with subcommand support and a global `-d` (alias `--dir`) argument that sets the working directory, a global `--json` boolean argument for machine-readable output, and a global `--schema` boolean argument for printing JSON Schema definitions. When invoked with no arguments, the CLI SHALL display help text listing available subcommands. The CLI SHALL externalize Node.js built-in modules and bundle all other dependencies. The `check` subcommand, the `auth` subcommand group, the `rules` subcommand group, and the `agent` subcommand SHALL be registered alongside existing subcommands. The `update-engine` subcommand SHALL NOT be registered.

#### Scenario: Running the CLI with no arguments shows help

- **WHEN** the CLI is executed with no arguments
- **THEN** it SHALL print help text to stdout listing available subcommands including `agent`
- **AND** the help text SHALL NOT list `update-engine`

#### Scenario: Running the CLI with an unknown subcommand shows help

- **WHEN** the CLI is executed with an unrecognized subcommand
- **THEN** it SHALL print help text to stdout

#### Scenario: Update-engine subcommand is not registered

- **WHEN** a user runs `taskless update-engine`
- **THEN** the CLI SHALL print help text (unrecognized subcommand)

#### Scenario: Init subcommand remains unchanged

- **WHEN** a user runs `taskless init`
- **THEN** the CLI SHALL route to the init subcommand handler
- **AND** the init handler SHALL NOT perform scaffold updates

#### Scenario: Update alias is removed

- **WHEN** a user runs `taskless update`
- **THEN** the CLI SHALL NOT route to the init handler
- **AND** SHALL show help text (unrecognized subcommand)

#### Scenario: Global -d flag is accepted

- **WHEN** the CLI is executed with `-d /some/path` or `--dir /some/path`
- **THEN** the specified path SHALL be available to all subcommands as the resolved working directory

#### Scenario: Working directory defaults to process.cwd()

- **WHEN** the CLI is executed without the `-d` flag
- **THEN** the working directory SHALL default to `process.cwd()`

#### Scenario: Global --json flag is accepted

- **WHEN** the CLI is executed with `--json`
- **THEN** the flag SHALL be available to all subcommands as `args.json`

#### Scenario: --json defaults to false

- **WHEN** a user runs a subcommand without `--json`
- **THEN** `args.json` SHALL be `false`

#### Scenario: Global --schema flag is accepted

- **WHEN** the CLI is executed with `--schema`
- **THEN** the flag SHALL be available to all subcommands as `args.schema`

#### Scenario: --schema defaults to false

- **WHEN** a user runs a subcommand without `--schema`
- **THEN** `args.schema` SHALL be `false`

#### Scenario: --schema is ignored by commands without --json support

- **WHEN** a user runs `taskless auth login --schema`
- **THEN** the CLI SHALL ignore the `--schema` flag and proceed normally

#### Scenario: Check subcommand is registered

- **WHEN** a user runs `taskless check`
- **THEN** the CLI SHALL route to the check subcommand handler

#### Scenario: Auth subcommand group is registered

- **WHEN** a user runs `taskless auth`
- **THEN** the CLI SHALL route to the auth subcommand group

#### Scenario: Rule subcommand group is registered

- **WHEN** a user runs `taskless rule`
- **THEN** the CLI SHALL route to the rule subcommand group

#### Scenario: Agent subcommand is registered

- **WHEN** a user runs `taskless agent`
- **THEN** the CLI SHALL route to the `agent` subcommand handler

### Requirement: CLI manages .taskless/.gitignore

The CLI SHALL proactively create and maintain a `.taskless/.gitignore` file that ignores local-only files. The gitignore SHALL contain entries for `.env.local.json` and `sgconfig.yml`. Any CLI command that writes to `.taskless/` SHALL ensure the `.gitignore` file exists with these entries before writing.

#### Scenario: .gitignore is created when .taskless/ is first written to

- **WHEN** the CLI creates any file in `.taskless/` (e.g., during `auth login`, `rule create`, or `check`)
- **AND** `.taskless/.gitignore` does not exist
- **THEN** the CLI SHALL create `.taskless/.gitignore` containing `.env.local.json` and `sgconfig.yml`

#### Scenario: Existing .gitignore is preserved

- **WHEN** `.taskless/.gitignore` already exists with additional user entries
- **AND** the CLI needs to ensure its entries are present
- **THEN** the CLI SHALL append any missing entries without removing existing content

#### Scenario: .gitignore entries are idempotent

- **WHEN** `.taskless/.gitignore` already contains `.env.local.json` and `sgconfig.yml`
- **THEN** the CLI SHALL NOT duplicate the entries

### Requirement: CLI infers repositoryUrl from git remote

The CLI SHALL infer the repository URL by running `git remote get-url origin` and canonicalizing the result to `https://github.com/{owner}/{repo}` format. Both SSH (`git@github.com:owner/repo.git`) and HTTPS (`https://github.com/owner/repo.git`) URLs SHALL be supported.

#### Scenario: HTTPS remote URL is canonicalized

- **WHEN** `git remote get-url origin` returns `https://github.com/acme/widgets.git`
- **THEN** the CLI SHALL resolve `repositoryUrl` as `https://github.com/acme/widgets`

#### Scenario: SSH remote URL is canonicalized

- **WHEN** `git remote get-url origin` returns `git@github.com:acme/widgets.git`
- **THEN** the CLI SHALL resolve `repositoryUrl` as `https://github.com/acme/widgets`

#### Scenario: No origin remote

- **WHEN** `git remote get-url origin` fails (no remote named `origin`)
- **THEN** the CLI SHALL print an error: "Could not determine repository URL from git remote. Ensure your repository has an 'origin' remote pointing to GitHub."
- **AND** the CLI SHALL exit with a non-zero exit code

#### Scenario: Non-GitHub remote URL

- **WHEN** `git remote get-url origin` returns a URL that is not a GitHub URL
- **THEN** the CLI SHALL print an error indicating only GitHub repositories are supported
- **AND** the CLI SHALL exit with a non-zero exit code

### Requirement: CLI resolves orgId from JWT

The CLI SHALL extract the `orgId` claim from the stored JWT by decoding it with `jose`'s `decodeJwt()` function. No signature verification SHALL be performed. If the JWT does not contain an `orgId` claim, the token is stale and the CLI SHALL prompt the user to re-authenticate.

#### Scenario: JWT contains orgId claim

- **WHEN** the stored JWT contains an `orgId` claim
- **THEN** the CLI SHALL use the JWT's `orgId` value

#### Scenario: JWT lacks orgId claim (stale token)

- **WHEN** the stored JWT does not contain an `orgId` claim
- **THEN** the CLI SHALL print an error: "Your auth token is missing organization info. Run `taskless auth login` to re-authenticate."
- **AND** the CLI SHALL exit with a non-zero exit code

### Requirement: CLI identity resolution function

The CLI SHALL provide a `resolveIdentity(cwd: string)` function that returns `{ orgId: number, repositoryUrl: string }`. This function combines JWT-based `orgId` resolution with git remote-based `repositoryUrl` inference. All commands that previously read identity from `taskless.json` SHALL use this function instead.

#### Scenario: Full identity resolved from JWT and git remote

- **WHEN** the JWT contains an `orgId` claim and `git remote get-url origin` returns a valid GitHub URL
- **THEN** `resolveIdentity()` SHALL return both `orgId` and `repositoryUrl`

#### Scenario: Auth token not available

- **WHEN** no token is available (no env var, no `.env.local.json`, no global auth file)
- **THEN** `resolveIdentity()` SHALL throw an error indicating authentication is required

### Requirement: CLI info subcommand outputs version as JSON

The CLI SHALL support a `taskless info` subcommand that outputs a JSON object to stdout. The object SHALL contain the CLI `version`, a `tools` array, a `loggedIn` boolean, a `repositoryUrl`, and a `ghOwner`. The `loggedIn` field SHALL be `true` when a token is available (via `TASKLESS_TOKEN` env var or token file) and `false` otherwise. Each entry in `tools` SHALL include the tool name, a list of installed skills with their versions, and whether each skill is current or outdated compared to the CLI's bundled version. When no tool directories are detected, the `tools` array SHALL be empty.

`repositoryUrl` SHALL be the canonical GitHub repository URL when one is resolvable from the git remote, and `null` otherwise. `ghOwner` SHALL be the owner segment of that URL when resolvable, and the literal `[unknown]` otherwise, matching the value telemetry records.

These fields exist so a caller deciding whether remote generation is available reads the same resolution the CLI enforces, rather than re-deriving the remote itself. `info` carries them because it is already the command consulted for capability state, and is already JSON. No new subcommand SHALL be added for this.

Neither field SHALL make `info` fail: an unresolvable remote is an ordinary state, not an error.

#### Scenario: Running taskless info outputs version, tool status, and login status

- **WHEN** a user runs `taskless info` in a repository with Claude Code installed and taskless skills present
- **THEN** stdout SHALL contain a JSON object with `version` (string), `tools` (array), and `loggedIn` (boolean)
- **AND** the `tools` array SHALL include an entry for Claude Code with installed skill versions and staleness status

#### Scenario: Info output is valid JSON

- **WHEN** a user runs `taskless info`
- **THEN** the stdout output SHALL be parseable by `JSON.parse()`
- **AND** the resulting object SHALL have a `version` property of type string, a `tools` property of type array, and a `loggedIn` property of type boolean

#### Scenario: Info with no tools detected

- **WHEN** a user runs `taskless info` in a directory with no tool directories
- **THEN** the `tools` array in the output SHALL be empty

#### Scenario: Info reports outdated skills

- **WHEN** an installed skill has a `metadata.version` that differs from the CLI's bundled version
- **THEN** the tool entry SHALL indicate the skill is outdated with both the installed and current versions

#### Scenario: Info reports logged in when token exists

- **WHEN** a token is available via `TASKLESS_TOKEN` env var or token file
- **THEN** `loggedIn` SHALL be `true`

#### Scenario: Info reports not logged in when no token

- **WHEN** no token is available
- **THEN** `loggedIn` SHALL be `false`

#### Scenario: Info reports the repository and owner when a GitHub remote is present

- **WHEN** a user runs `taskless info --json` in a repository whose `origin` is a GitHub URL
- **THEN** `repositoryUrl` SHALL be the canonical `https://github.com/{owner}/{repo}` form
- **AND** `ghOwner` SHALL be that URL's owner segment

#### Scenario: Info reports no repository in each no-remote population

- **WHEN** a user runs `taskless info --json` in a directory that is not a git repository, in a repository with no `origin`, or in a repository whose `origin` is not GitHub
- **THEN** `repositoryUrl` SHALL be `null`
- **AND** `ghOwner` SHALL be `[unknown]`
- **AND** the command SHALL exit successfully

### Requirement: CLI version is injected at build time

The CLI's `vite.config.ts` SHALL use the Vite `define` option to replace a `__VERSION__` sentinel with the version the build reports as its own, resolved at build time. For every build target but `nightly` that is the version string in `packages/cli/package.json`. A `nightly` is the exception, because its version is stamped when the publishable artifact is produced and the committed manifest is deliberately left unchanged, so `package.json` names the release the nightly anticipates rather than the nightly itself (see the `cli-nightly-builds` capability). No runtime file reads or import assertions SHALL be used for version resolution.

#### Scenario: Build replaces version sentinel

- **WHEN** `pnpm build` is run in `packages/cli/`
- **THEN** all occurrences of `__VERSION__` in source code SHALL be replaced with the literal version string from package.json

#### Scenario: A nightly build replaces the sentinel with its own stamped version

- **WHEN** a `nightly` build is run
- **THEN** `__VERSION__` SHALL be replaced with the version the nightly is published under, not the version in package.json

### Requirement: citty is the argument parser

The CLI SHALL use `citty` as its sole argument parsing dependency. Each subcommand SHALL be defined as an isolated command object and registered with the main CLI via `defineCommand` and `runMain`.

#### Scenario: citty is declared as a dependency

- **WHEN** inspecting `packages/cli/package.json`
- **THEN** `citty` SHALL be listed in `dependencies`

### Requirement: CLI accepts global --anonymous flag with per-command behavior

The CLI SHALL accept a top-level boolean flag `--anonymous` on every subcommand. The flag's behavior SHALL vary by command:

- `rule create`, `rule improve`: switch to local-only flow (no API calls); SHALL be the only way to reach the local-only path
- `rule delete`, `rule verify`, `rule meta`, `check`, `auth logout`, `init`, `update`: accepted as no-op; SHALL succeed without changing behavior
- `info`: skip the API/auth probe; report local state only (CLI version, skills installed, no auth call)
- `auth login`: SHALL exit with code 1 and an error message stating "auth commands cannot be anonymous"

The flag SHALL be recognized whether placed before or after positional arguments (per `citty` parsing).

#### Scenario: --anonymous on rule create switches to local flow

- **WHEN** a user runs `taskless rule create --from req.json --anonymous`
- **THEN** the CLI SHALL execute the local-only branch (no API calls)
- **AND** SHALL produce the same output shape as the API-backed branch

#### Scenario: --anonymous on check is a no-op

- **WHEN** a user runs `taskless check --anonymous`
- **THEN** the CLI SHALL execute identically to `taskless check` (no warning, no error)

#### Scenario: --anonymous on info skips API probe

- **WHEN** a user runs `taskless info --anonymous`
- **THEN** the CLI SHALL report local state only (CLI version, installed skills, scaffold version)
- **AND** SHALL NOT make any HTTP request to verify auth state

#### Scenario: --anonymous on auth login is rejected

- **WHEN** a user runs `taskless auth login --anonymous`
- **THEN** the CLI SHALL exit with code 1
- **AND** SHALL print an error message stating "auth commands cannot be anonymous"

### Requirement: Error output uses stable codes when --json is set

When any CLI command exits with an error AND `--json` was passed, the command SHALL output a JSON envelope with the shape:

```json
{
  "ok": false,
  "code": "<STABLE_CODE>",
  "message": "<human-readable message>"
}
```

The `code` field SHALL be drawn from a stable enum defined in `packages/cli/src/types/errors.ts`. The enum SHALL include at minimum: `AUTH_REQUIRED`, `NO_GITHUB_REMOTE`, `RULE_GENERATION_FAILED`, `RULE_NOT_FOUND`, `INVALID_INPUT`, `NETWORK_ERROR`. New codes MAY be added but existing codes SHALL NOT be renamed without a major version bump. Recipes reference these codes by name in their `## Errors` section, so stability is required.

#### Scenario: Auth-required error in JSON mode

- **WHEN** a user runs `taskless rule create --from req.json --json` while logged out
- **THEN** stdout SHALL contain `{ "ok": false, "code": "AUTH_REQUIRED", "message": "..." }`
- **AND** the exit code SHALL be non-zero

#### Scenario: Error code stability is enforced by tests

- **WHEN** the test suite runs
- **THEN** there SHALL be tests verifying the exact `code` strings emitted for each error path
- **AND** renaming a code in the enum without updating both the implementation and the tests SHALL break the build

### Requirement: ast-grep is declared as platform packages, not a wrapper

`packages/cli` SHALL declare the ast-grep platform packages in `optionalDependencies` and SHALL NOT declare the `@ast-grep/cli` wrapper package as a runtime dependency. Every platform package SHALL be pinned to the same exact ast-grep version.

The wrapper MAY be declared as a `devDependency` where a build-time script needs its version, since a devDependency is not installed for consumers and therefore cannot affect the shipped product.

`optionalDependencies` specifically: a `devDependency` is not installed for consumers of the CLI, and a hard `dependency` would fail the install on every host the package does not match. `optional` is what allows `os`/`cpu` filtering to install exactly one package and skip the rest without error, so an unsupported host SHALL install the CLI successfully with no platform package present.

#### Scenario: Only the host-matching package installs

- **WHEN** the CLI is installed on a supported platform
- **THEN** only the ast-grep platform package matching the host's `os` and `cpu` is installed, and the binary is resolvable from the CLI's module context

#### Scenario: The wrapper is absent from what consumers install

- **WHEN** a published CLI tarball's `dependencies` and `optionalDependencies` are inspected
- **THEN** `@ast-grep/cli` is not among them, so no consumer installs it or runs its install script

#### Scenario: Platform packages stay in lockstep

- **WHEN** the declared ast-grep platform packages are inspected
- **THEN** every one is pinned to the same exact version, so no two hosts run different ast-grep versions against the same rules

#### Scenario: Unsupported platform still installs

- **WHEN** the CLI is installed on a platform with no published ast-grep package
- **THEN** the install succeeds with no platform package present and no install-time error

### Requirement: The ast-grep binary requires no install-time step

The ast-grep binary SHALL be usable purely by dependency resolution. Its availability SHALL NOT depend on a dependency lifecycle script having run, and SHALL NOT depend on any file having been copied or linked into another package at install time.

#### Scenario: Binary is available with lifecycle scripts disabled

- **WHEN** the CLI is installed with dependency lifecycle scripts disabled
- **THEN** the ast-grep binary is present and executable, and every ast-grep-backed command runs

#### Scenario: Isolated installs resolve the real binary

- **WHEN** the CLI is executed from an install with strict dependency isolation, such as `pnpm dlx`
- **THEN** the resolved path is the real executable, never a placeholder file

### Requirement: Binary resolution searches all known locations before failing

Resolution SHALL search candidate locations in descending order of confidence — the host's platform package, then `node_modules/.bin`, then `sg` and `ast-grep` on `PATH` — and SHALL return the first that is an executable file. All ast-grep invocations SHALL use this single resolution path.

When no candidate yields an executable, resolution SHALL fail with an error naming the locations it tried. It SHALL NOT return a bare command name and leave the failure to surface as a spawn error.

#### Scenario: Platform package wins over a host install

- **WHEN** the platform package resolves and an unrelated ast-grep is also present on `PATH`
- **THEN** the platform package's binary is executed, because it is the version the CLI pinned

#### Scenario: A host install is used when no platform package resolves

- **WHEN** no platform package is installed for the host but ast-grep is available on `PATH`
- **THEN** resolution returns that binary and ast-grep-backed commands run normally

#### Scenario: Exhausted search fails with a useful message

- **WHEN** no candidate location yields an executable
- **THEN** resolution fails with an error naming the locations that were tried, rather than deferring to a spawn failure

### Requirement: The CLI declares Vale platform packages as optional dependencies

`packages/cli` SHALL declare every supported Vale platform package in `optionalDependencies`, so that installing the CLI also installs the Vale binary matching the host. Each SHALL be pinned to a literal exact version rather than a range or a workspace protocol, so that a newly published platform package reaches the CLI only through a deliberate change.

The declaration SHALL NOT be a `devDependency`, which would not be installed for consumers of the CLI. `optionalDependencies` is required so an unsupported host installs the CLI successfully with no platform package present.

#### Scenario: Installing the CLI brings the host's Vale binary

- **WHEN** the CLI is installed on a supported platform
- **THEN** the matching Vale platform package is installed alongside it and the binary is resolvable from the CLI's module context

#### Scenario: Unsupported platform still installs

- **WHEN** the CLI is installed on a platform with no published Vale package
- **THEN** the install succeeds with no platform package present, and no error is raised at install time

#### Scenario: Versions are pinned exactly

- **WHEN** the CLI's `optionalDependencies` are inspected in a published tarball
- **THEN** each Vale platform package is pinned to a single exact version, not a range or workspace protocol

#### Scenario: A newer platform package does not change the CLI

- **WHEN** a platform package is published for a newer upstream Vale release and the CLI's pin is unchanged
- **THEN** the CLI continues to resolve the pinned version

### Requirement: The CLI determines how it was launched from the path it was launched from

The CLI SHALL determine the command a user would type to reach it again from the shape of `process.argv[1]` together with the process environment, and SHALL expose that determination as a function that is pure over an injected context — an environment record and an argv array — so every launcher case is testable without spawning a process. This mirrors `resolveBuildTarget`, which is pure over an injected `BuildEnvironment` for the same reason.

The detection SHALL recognize two launchers:

- **npx**, identified by an `_npx` cache path segment in `argv[1]`, or by the environment reporting an `exec` command whose lifecycle event is `npx`.
- **pnpm dlx**, identified by a `pnpm/` user agent together with a `dlx` cache path segment in `argv[1]`.

The detection SHALL return "unknown" for everything else, and "unknown" SHALL be a first-class answer rather than a fallback to npx. In particular, `pnpm run`, `pnpm exec`, and pnpm lifecycle scripts all set a `pnpm/` user agent while running the CLI out of the repository's own `node_modules`; they SHALL NOT be reported as `pnpm dlx`. A bare `node` invocation, a `node_modules/.bin` shim, and a global install set no distinguishing signal and SHALL all be reported as unknown.

Yarn and bun are deliberately not detected. They are distinguishable only by the user agent, which the pnpm case demonstrates is not evidence of how the user invoked anything.

#### Scenario: An npx launch is recognized

- **WHEN** the CLI is launched by `npx` and `argv[1]` lies under the npx cache
- **THEN** detection SHALL report an npx launch

#### Scenario: A pnpm dlx launch is recognized

- **WHEN** the CLI is launched by `pnpm dlx` and `argv[1]` lies under pnpm's dlx cache
- **THEN** detection SHALL report a pnpm dlx launch

#### Scenario: A pnpm script is not mistaken for pnpm dlx

- **WHEN** the CLI runs from a `package.json` script under pnpm, with a `pnpm/` user agent and an `argv[1]` inside the repository's `node_modules`
- **THEN** detection SHALL report unknown, not pnpm dlx

#### Scenario: A bare launch is unknown

- **WHEN** the CLI is launched with no package-manager environment at all
- **THEN** detection SHALL report unknown

### Requirement: User-facing CLI invocations name the package the reader is running

Wherever the CLI prints a command for the user to run — an authentication prompt, a re-authentication hint, an error remedy — it SHALL compose that command from the detected launcher and from the package specifier of the build in hand, not from a hardcoded string.

The package specifier SHALL come from the build-target invocation, so a nightly build names `@taskless/cli-nightly` at its published version and a prod build names `@taskless/cli`. A prod specifier SHALL be pinned to `@latest` when it is handed to a launcher, since `npx` and `pnpm dlx` otherwise prefer whatever is already cached. A build whose invocation is a filesystem path (`dev`, `self`) SHALL be printed verbatim, since no launcher applies to it.

Where detection reports unknown, the printed command SHALL name `npx` with the correct package specifier. That is a display default for a human reader who needs something runnable, and it is distinct from the recipe renderer's marker, which is read by an agent that can be asked to supply the right answer.

#### Scenario: A nightly names itself in an error message

- **WHEN** a nightly build prints an authentication remedy
- **THEN** the printed command SHALL name `@taskless/cli-nightly` at the nightly's own version, not `@taskless/cli`

#### Scenario: A pnpm script no longer suggests pnpm dlx

- **WHEN** the CLI runs from a `package.json` script under pnpm and prints an authentication remedy
- **THEN** the printed command SHALL NOT suggest `pnpm dlx`, because that is not how the reader reached the CLI
