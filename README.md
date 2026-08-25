# Taskless Skills

A skills repository for agentic workflows, built for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and other Agent capable systems.

Includes a CLI that works with agentic systems (and humans too) at @taskless/cli.

## Structure

```
skills/
  taskless/SKILL.md                # Single consolidated router skill
commands/
  tskl/tskl.md                     # Single /tskl router command
packages/
  cli/                             # @taskless/cli, recipes live in cli/src/agent/
scripts/
  sync-skill-versions.ts           # Syncs metadata.version to CLI version
.claude-plugin/                    # Claude Code Plugin Marketplace manifest
```

## Skill

Starting in v0.7, Taskless ships a **single consolidated skill** (`taskless`) plus a single `/tskl` slash command. The skill body is a small router; per-task instructions live behind `npx @taskless/cli agent <topic>` and are fetched on demand.

| Skill      | Command       | Description                                            |
| ---------- | ------------- | ------------------------------------------------------ |
| `taskless` | `/tskl <ask>` | Router for any Taskless action (create rule, improve,  |
|            |               | delete, check, auth, CI). Fetches the canonical recipe |
|            |               | for the user's intent and follows it.                  |

Available `taskless agent` topics: `route`, `create-sg-rule`, `create-vale-rule`, `create-runtime-rule`, `create-remote-rule`, `improve-rule`, `delete-rule`, `check`, `auth`, `ci`, `info`, `init`, `update`. Run `taskless agent` with no topic for the index. Append `--anonymous` for the local-only flow on improve.

## CLI

The `@taskless/cli` package provides a CLI agent for Taskless workflows. It's recommended to always call the `latest` tag unless you know you need a specific version:

```bash
npx @taskless/cli@latest info
```

## Local development

The CLI bakes its own invocation string into the skill, command, and recipe
content it installs. Three build targets pick that string, all driven by the
`TASKLESS_BUILD_TARGET` env var via Vite `define` (same source files, no edits):

Each target also emits to its own directory so the three never overwrite one
another. Prod → `dist/`, dev → `dist-dev/`, self → `dist-self/` (all
gitignored):

| Command           | Output dir   | Baked invocation                            | Use for                                                                              |
| ----------------- | ------------ | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm build`      | `dist/`      | `npx @taskless/cli`                         | Production / published builds (default).                                             |
| `pnpm build:dev`  | `dist-dev/`  | `node <abs>/packages/cli/dist-dev/index.js` | Validating this build from **another** repo (absolute path resolves anywhere).       |
| `pnpm build:self` | `dist-self/` | `node packages/cli/dist-self/index.js`      | Dogfooding **in this repo** (path is repo-root-relative; run the CLI from the root). |

`pnpm build:self` builds the CLI with the relative invocation and then runs
`taskless init --no-interactive` to install into this repo, so `.claude` gets
real reference stubs that delegate to the canonical `.taskless/` content, exactly
like any other install. (This replaces the former raw-symlink `link-skills`
step, so local dogfooding always matches a true install.)

> The `dev`/`self` invocations are local paths and must never be published:
> only `pnpm build` (or `pnpm package`) produces a release artifact.

## Releasing taskless/cli

Releases use [Changesets](https://github.com/changesets/changesets) with Turborepo for orchestration.

### Release process

Start from a clean repo (no uncommitted changes), then:

```bash
pnpm bump               # Bump versions and sync skill metadata
pnpm build              # Build CLI and generate commands
pnpm test               # Run all tests, confirm no errors
git add -A              # Stage all changes
git commit -m "chore: Releases vx.y.z"  # Commit with new version number
git push origin main    # Push the release commit
pnpm release            # Dry run, prints publish command when ready
pnpm release:production # Publish to npm (prompts for 2FA OTP)
```

After publishing, tag the release commit so the published version is traceable
in git history:

```bash
git tag -s vx.y.z -m "Release vx.y.z"  # Signed tag on the release commit
git push origin vx.y.z
```

Tagging started at `v0.9.0`; earlier releases were not tagged.

### Nightly builds

Work that has merged to `main` but is not yet released is published as
**`@taskless/cli-nightly`**, so unreleased behavior can be installed and
exercised without waiting for a release:

```bash
npx @taskless/cli-nightly@latest --version   # or: npm i -g @taskless/cli-nightly
```

- **The executable is `taskless`**, the same as the release. Every documented
  invocation, skill, and recipe works unchanged against a nightly.
- **Because the binary name is the same, a nightly and `@taskless/cli` collide
  when both are installed globally.** That is not a supported configuration: a
  nightly is a drop-in for the release it anticipates, not a companion to it.
  Use one or the other globally, or install the nightly into a project.
- Versions look like `0.11.0-20260818123456x05b3c88`. The release the nightly
  anticipates, the UTC build time, and the commit it was built from. Every one
  of them is a prerelease, and the newest always carries the `latest` tag, so
  installing with no version gives you the most recent nightly.
- A nightly is published on each push to `main` that has changesets pending, and
  is the same build as the release it anticipates, differing only in package
  name and version. When the Version Packages PR merges, the changesets are
  consumed and the real `@taskless/cli` release publishes instead.

### Adding a new topic recipe

In v0.7+, new agent-facing instructions are added as **recipes**, not skills. To add a recipe:

1. Create `packages/cli/src/agent/<topic>.txt` following the canonical template (Goal / Preconditions / Steps / Input schema / Errors / See Also).
2. Use `{{CLI_VERSION}}` and `{{INPUT_SCHEMA}}` placeholders for runtime interpolation.
3. For topics with a substantively different local-only flow, add `<topic>.anonymous.txt`. The `agent` command's variant lookup is automatic.
4. Update the topic table in `skills/taskless/SKILL.md` and `commands/tskl/tskl.md` so agents can discover the new topic.

### Distribution channels

- **`taskless init`**: CLI installs the consolidated skill to `.claude/skills/taskless/` and the command to `.claude/commands/tskl/`
- **Claude Code Plugin Marketplace**: `.claude-plugin/marketplace.json` and `plugin.json`
- **Vercel Skills CLI**: `npx skills add` discovers skills from `skills/` directory
