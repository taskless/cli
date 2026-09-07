# dotagents

This repository manages its agent configuration with
[dotagents](https://github.com/getsentry/dotagents), a dependency manager for
skills, subagents, plugins, MCP servers, and hooks. One declaration in
`agents.toml` resolves into the layout each agent tool expects, so Claude Code,
Cursor, Codex, and the rest read the same configuration.

Read the tool's own documentation at
[getsentry/dotagents](https://github.com/getsentry/dotagents). What follows is
how this repository uses it, and what is worth taking from here into yours.

## How it runs here

| Command                 | What it does                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| `pnpm dotagents`        | `dotagents --project`, scoped to this repository                 |
| `pnpm dotagents doctor` | Diagnoses a broken or partial install                            |
| `postinstall`           | Runs `dotagents install` outside CI, and never fails the install |

The `postinstall` hook is deliberately forgiving. It is skipped when `$CI` is
set, and a failure prints a hint to run `pnpm dotagents doctor` rather than
breaking `pnpm install`. Agent configuration going missing should not stop
anyone from building the project.

Note the `--project` flag. Unqualified `dotagents` commands are **global**, so
`dotagents add ...` run in this directory edits `~/.agents/agents.toml` rather
than this repository's. Reaching for `pnpm dotagents` brings the flag with it.

## Managed versus committed

Two kinds of skill live under `.agents/skills/`, and telling them apart matters
before you edit one.

**Managed by dotagents.** Declared in `agents.toml`, installed on demand, and
listed in `.agents/.gitignore` (which dotagents writes). Editing one in place
accomplishes nothing, because the next install overwrites it. Today that is
`dotagents`, `code-review`, and `pr-writer`.

**Committed to this repository.** Everything else under `.agents/skills/` is
tracked in git and reviewed like any other source. Two of them started as
upstream skills and were changed enough that vendoring beat pinning.

`.claude/skills` is a symlink to `.agents/skills`, so Claude Code sees both
kinds without a second copy.

## Taking skills from this repository

**`dotagents add taskless/cli` does not give you the skills below.** This
repository carries a `.claude-plugin/plugin.json`, and `add` checks a source for
plugins first: when it finds one, the source is plugin-only. So that command
adds a plugin named `taskless` with `path = "."`, which vendors the entire
repository (including `packages/`, `example/`, and the lockfile) into
`.agents/plugins/taskless/`. What it ships is the Taskless skill and the `tskl`
command, which is the right way to get those, and it is not a route to
`iterate-pr`.

To take the development skills, declare them with an explicit `path`. One skill:

```toml
[[skills]]
name = "iterate-pr"
source = "taskless/cli"
path = ".agents/skills/iterate-pr"
```

Or take the set at once. The wildcard finds every tracked skill, so the
exclusions are what make it a recommendation rather than a dump:

```toml
[[skills]]
name = "*"
source = "taskless/cli"
path = ".agents/skills"
exclude = [
  # A shim for a skill the Taskless CLI installs itself. See below.
  "taskless",
  # Spec-driven development is a workflow choice, not ours to make for you.
  # These belong to the openspec CLI. See below.
  "openspec-apply-change",
  "openspec-archive-change",
  "openspec-bulk-archive-change",
  "openspec-continue-change",
  "openspec-explore",
  "openspec-ff-change",
  "openspec-new-change",
  "openspec-onboard",
  "openspec-propose",
  "openspec-sync-specs",
  "openspec-verify-change",
]
```

That installs three skills: `code-simplifier`, `iterate-pr`, and
`worktrees-pnpm`. Without the exclusions the same entry resolves to 14, because
the wildcard reaches every tracked skill. Only tracked ones appear either way,
since the dotagents-managed three are gitignored and never reach a clone.

`exclude` takes literal skill names. A pattern such as `"openspec-*"` is
refused when the config is validated (`skills.0: Invalid input`), because an
entry has to satisfy the skill-name rules, which permit `[a-zA-Z0-9._-]` and no
`*`. Hence the eleven lines.

### The ones worth having

| Skill             | What it is for                                                                                                                                        | Needs          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `iterate-pr`      | Drives a PR to green: reads CI failures, buckets review feedback on the LOGAF scale, replies to and resolves threads, and handles stacked-PR restacks | `gh`, Node     |
| `worktrees-pnpm`  | Git worktrees in a pnpm workspace, including the install step that is easy to forget, and the cleanup                                                 | pnpm workspace |
| `code-simplifier` | Simplifying code for clarity while preserving behaviour                                                                                               | nothing        |

`iterate-pr` is the one most worth having. Its five scripts are zero-dependency
CommonJS, stdlib only, so adopting it adds no toolchain: they spawn `gh` and
`git` with argv arrays and no shell, and each carries a `node --test` suite.

## Exclude the `openspec-*` skills

The eleven `openspec-*` skills are committed here, and the recommendation is to
leave them out. Two reasons, and the second is the one that matters.

They are generated by the [openspec](https://github.com/Fission-AI/OpenSpec)
CLI, so a copy taken from this repository is a snapshot of whatever version was
current when it was generated. Install them from openspec and you get the set
matching your CLI.

More to the point, they encode a way of working rather than a capability.
Spec-driven development suits this repository and it may not suit yours, and
pushing that decision through a skill bundle is not our business. `iterate-pr`
and `worktrees-pnpm` do a job you already have. These describe a process you
would be adopting. Take them if you run openspec, from openspec.

## Exclude the `taskless` skill

`.agents/skills/taskless/SKILL.md` is a **shim**, marked `type: shim` in its own
frontmatter. Its entire body points somewhere else:

> This is a Taskless reference stub. The canonical skill is defined at
> `.taskless/skills/taskless/SKILL.md`.

The Taskless CLI writes that canonical file during `npx @taskless/cli init` and
records the version it was built against (`install.cliVersion` in
`.taskless/taskless.json`). Pulling the shim through dotagents therefore gets
you a stub pointing at a path you do not have. If you then run `init`, two tools
claim the same skill: dotagents installs the stub and the CLI writes the real
one, each overwriting whatever the other did last.

So `exclude = ["taskless"]` on the wildcard entry above, and run
`npx @taskless/cli init` instead. The CLI owns its skill at the version it ships
with.

The same reasoning covers any skill a tool installs for itself. A version pin
and a dependency manager are two answers to "which version of this do I have",
and running both over one file gives you neither.

## Where these came from

Credit where it is owed, and a pointer for anyone tracking upstream changes.

| Skill                      | Origin                                                                                                                                                                                                                  | Relationship                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `code-review`, `pr-writer` | [getsentry/skills](https://github.com/getsentry/skills)                                                                                                                                                                 | Managed by dotagents, unmodified  |
| `dotagents`                | [getsentry/dotagents](https://github.com/getsentry/dotagents)                                                                                                                                                           | Managed by dotagents, unmodified  |
| `iterate-pr`               | [getsentry/skills](https://github.com/getsentry/skills/tree/main/skills/iterate-pr) (Apache-2.0)                                                                                                                        | Forked and substantially modified |
| `code-simplifier`          | [getsentry/skills](https://github.com/getsentry/skills), which credits [Anthropic's code-simplifier](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md) | Vendored copy                     |
| `openspec-*`               | [openspec](https://github.com/Fission-AI/OpenSpec) (MIT)                                                                                                                                                                | Generated by the openspec CLI     |
| `worktrees-pnpm`           | This repository                                                                                                                                                                                                         | Written here                      |
| `taskless`                 | `@taskless/cli`                                                                                                                                                                                                         | Shim, see above                   |

`iterate-pr` is the one that has diverged. It gained stack-aware tooling, LOGAF
feedback bucketing, self-review handling, pending-reviewer tracking, and a port
of its scripts from Python to Node. The fork notice at the top of its `SKILL.md`
records the original, and the upstream skill remains the better starting point
if you want none of that.

## Trust

`agents.toml` declares which sources may be installed from:

```toml
[trust]
github_orgs = [ "taskless" ]
github_repos = [ "getsentry/skills", "getsentry/dotagents" ]
```

A source outside that list is refused rather than fetched. Widen it
deliberately, and per repository rather than per organisation where you can. A
skill is instructions an agent will follow, so adding a trusted source has more
in common with adding a dependency than with adding a bookmark.
