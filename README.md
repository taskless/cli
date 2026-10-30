# Taskless

Taskless turns the corrections you give your coding agent into rules that run on every change. Correct once. Enforced forever.

## What Taskless is

When you correct your coding agent, Taskless captures that correction as a rule: a real file in your repo, enforced by [ast-grep](https://ast-grep.github.io), [Vale](https://vale.sh), or a runtime check. The same rules run in your editor, for every agent, and in CI, with one command and one exit code. You can start without an account.

## Get started

**1. Install the skill.** In a repository with a coding agent configured (a `.claude/`, `.cursor/`, `.opencode/`, or `.agents/` directory), run the installer:

```bash
npx @taskless/cli
```

It detects your agent tools and installs the Taskless skill into each of them. `pnpm dlx`, `bun x`, and `yarn dlx` work too.

**2. Get onboarded.** Ask your agent to help you get started with Taskless. It reviews your codebase and history and helps you turn the strongest candidates into rules.

**3. Create a rule.** Describe it in plain language:

> Create a taskless rule that catches direct fetch() calls without error handling.

Rules are authored and validated locally, with no account and no API calls. Your agent tells you before it uses the Taskless service.

**4. Check your code.** Ask your agent to run taskless check, or run it yourself through the project launcher the installer writes:

```bash
./.taskless/bin/cli.mjs check
```

Matches are reported with file, line, severity, and message. The command exits `1` on error-severity matches, so it drops straight into CI. Ask your agent to "add taskless to CI" to wire it into the CI system you already use.

A free [Taskless account](https://docs.taskless.io/getting-started/full-setup/) adds AI-powered rule generation with validation and test cases, plus a GitHub integration that turns PR comments and issues into rules. See the [Taskless docs](https://docs.taskless.io/getting-started/) for the full guide, including tips for writing better rules.

## What's in this repository

This repository is the source for three things that ship together:

1. **The Taskless CLI**, published to npm as [`@taskless/cli`](https://www.npmjs.com/package/@taskless/cli).
2. **The Vale platform packages**, `@taskless/vale-*`: the [Vale](https://vale.sh) executable for each supported OS and CPU, wrapped in an npm package so the CLI can run it with no download step.
3. **The canonical Taskless skill**, the `SKILL.md` that agents (Claude Code and others) load to work with Taskless, plus the recipes it routes to.

All of them publish from GitHub Actions through npm trusted publishing (OIDC). No npm token is stored anywhere in this repository.

```
packages/
  cli/                       # @taskless/cli
    src/agent/               # recipes served by `taskless agent <topic>`
  vale-<os>-<cpu>/           # @taskless/vale-* platform packages (six of them)
skills/
  taskless/SKILL.md          # the canonical Taskless skill
.claude-plugin/              # Claude Code Plugin Marketplace manifest
.github/
  scripts/vale-manifest.json # pinned Vale release and its SHA256 digests
  workflows/                 # release, nightly, Vale, and validation pipelines
scripts/                     # version, changelog, and skill-metadata helpers
openspec/                    # specs and in-flight change proposals
```

## 1. The Taskless CLI

`@taskless/cli` creates, checks, and manages Taskless rules in a project, for agents and for people. The installer pins the CLI version in `.taskless/taskless.json` and writes a launcher, `./.taskless/bin/cli.mjs`, that runs exactly that version. Run every command through the launcher. Any other CLI version refuses to run in the project.

See [`packages/cli/README.md`](./packages/cli/README.md) for the full command reference.

### Releases

Releases are automated with [Changesets](https://github.com/changesets/changesets):

1. A pull request that changes the CLI adds a changeset (`pnpm changeset`).
2. On merge to `main`, `release-cli-changeset.yml` maintains a **Version Packages** pull request that folds pending changesets into the version and `CHANGELOG.md`.
3. Merging that pull request triggers `release-cli.yml`, which publishes `@taskless/cli` with provenance over OIDC and tags the released commit (`vX.Y.Z`).

Tagging started at `v0.9.0`; earlier releases weren't tagged.

### Nightly builds

Everything merged to `main` publishes as **`@taskless/cli-nightly`**, so you can try unreleased changes without waiting for a release:

```bash
npx @taskless/cli-nightly@latest --version
```

The nightly's executable is also `taskless`, so it replaces the release when installed. Installing both globally collides on that binary, so install one or the other.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how nightlies are versioned and published, and for how to test against one without disturbing a release you already have installed.

## 2. The Vale platform packages

Taskless runs prose rules with [Vale](https://vale.sh). The CLI lists one npm package per platform as an optional dependency, and the package manager installs only the one matching the host. Nothing downloads at install time.

| Package                       | Platform             |
| ----------------------------- | -------------------- |
| `@taskless/vale-darwin-arm64` | macOS, Apple silicon |
| `@taskless/vale-darwin-x64`   | macOS, Intel         |
| `@taskless/vale-linux-arm64`  | Linux, 64-bit ARM    |
| `@taskless/vale-linux-x64`    | Linux, x86-64        |
| `@taskless/vale-win32-arm64`  | Windows, 64-bit ARM  |
| `@taskless/vale-win32-x64`    | Windows, x86-64      |

Each package holds the upstream `vale` binary, its MIT `LICENSE`, a README, and `package.json`. It has no JavaScript and no install script, so it works under package managers that refuse dependency build scripts.

The binaries aren't committed. The pipeline works in two halves:

- **`release-vale.yml`** watches upstream Vale releases. When one appears it opens a pull request that pins the new version and its six archive digests in `.github/scripts/vale-manifest.json`. After a person reviews and merges it, the workflow downloads each archive, verifies it against the committed digest, and publishes the packages over OIDC as `<valeVersion>-<timestamp>`.
- **`vale-upgrade.yml`** moves the CLI's pins onto the newly published set, as a separate pull request.

The Vale packages are versioned outside Changesets, and publishing them changes nothing for a CLI user until the CLI's pins move. Each package's README covers versioning and provenance in detail.

## 3. The Taskless skill

[`skills/taskless/SKILL.md`](./skills/taskless/SKILL.md) is the canonical Taskless agent skill. It's a small router. For any Taskless action (create, improve, or delete a rule, run checks, authenticate, wire CI), it fetches the matching recipe with `taskless agent <topic>` and follows it. `taskless agent` with no topic lists every topic.

The recipes themselves live in [`packages/cli/src/agent/`](./packages/cli/src/agent/) and are embedded into the CLI bundle at build time, so a recipe always matches the CLI version that serves it.

The skill reaches agents through these channels:

- **The installer** (`npx @taskless/cli`) installs the skill to `.taskless/skills/taskless/` and a reference stub in each harness's skill directory, such as `.claude/skills/taskless/`.
- **Claude Code Plugin Marketplace** reads `.claude-plugin/marketplace.json` and `plugin.json`.
- **Vercel Skills CLI** (`npx skills add`) discovers skills from the `skills/` directory.

The skill's `metadata.version` tracks the CLI version. `pnpm bump` syncs it, and the CLI build fails if the two disagree.

### Adding a new topic recipe

Agent-facing instructions are **recipes** served by the one skill. To add a topic:

1. Create `packages/cli/src/agent/<topic>.md` following the template the existing recipes use (Goal / Preconditions / Steps / Input schema / Errors / See Also).
2. For a topic with a substantively different local-only flow, add `<topic>.anonymous.md`. The `agent` command looks up the variant automatically.
3. Update the topic table in `skills/taskless/SKILL.md` so agents can discover the new topic.

## Local development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, checks, and the pull request process.

The CLI bakes its own invocation string into the skill, command, and recipe content it installs. The build target picks that string through the `TASKLESS_BUILD_TARGET` env var and Vite `define`, from the same source files. Each target writes to its own gitignored directory, so the builds never overwrite each other:

| Command           | Output dir   | Baked invocation                       | Use for                                                                              |
| ----------------- | ------------ | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm build`      | `dist/`      | `npx @taskless/cli`                    | Production / published builds (default).                                             |
| `pnpm build:self` | `dist-self/` | `node packages/cli/dist-self/index.js` | Dogfooding **in this repo** (path is repo-root-relative; run the CLI from the root). |

`pnpm build:self` builds the CLI with the relative invocation and then runs `taskless init --no-interactive` to install into this repo, so `.claude` gets real reference stubs that delegate to the canonical `.taskless/` content, exactly like any other install.

> The `self` invocation is a local path and must never be published: only `pnpm build` produces a release artifact. It's also relative to this repo root, so no build target here yields a CLI you can run from another repository. Use a published nightly for that.

### Running the local build

The root `package.json` defines a `cli` script pointing at `./packages/cli/dist/index.js`. That script runs the CLI built from this working tree instead of a published release, which is what `AGENTS.md` points contributors and agents at while they're working in this repo. Nothing rebuilds `dist/` for you, so run `pnpm build` first when you want current behavior.

## License

MIT. See [LICENSE](./LICENSE). The Vale binaries carry Vale's own MIT license, shipped unmodified in each platform package.
