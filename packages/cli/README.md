# @taskless/cli

[![npm](https://img.shields.io/npm/v/@taskless/cli)](https://www.npmjs.com/package/@taskless/cli)
[![build](https://img.shields.io/github/actions/workflow/status/taskless/cli/validate.yml?branch=main)](https://github.com/taskless/cli/actions/workflows/validate.yml?query=branch%3Amain)
[![nightly](https://img.shields.io/badge/nightly-npm-blue)](https://www.npmjs.com/package/@taskless/cli-nightly)
[![vale](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/taskless/cli/main/.shields/vale.json)](https://github.com/errata-ai/vale/releases)
[![sg](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/taskless/cli/main/.shields/sg.json)](https://github.com/ast-grep/ast-grep/releases)

CLI companion for [Taskless](https://taskless.io). Designed to work with agent skills to add constraints that improve coding agent output.

## Install

```bash
npx @taskless/cli
```

Run with no arguments in a terminal to launch the installer, which detects the
agent tools in your project (Claude Code, Cursor, OpenCode) and installs into
each of them. For scripted installs and upgrades, `init` runs the same install
without prompts, in a terminal or not:

```bash
npx @taskless/cli init
```

`init` records its version in `.taskless/taskless.json` and writes a launcher,
`./.taskless/bin/cli.mjs`, that runs exactly that version. Any other version of
the CLI refuses every command except `init`, `info`, `auth`, and `feedback`
with `CLI_VERSION_MISMATCH`, because a project's rules are reconciled against
the CLI it records. So npx is only for installing, upgrading, and logging in
(`auth login` works from any version): once a project is installed, run every
other command through the launcher, and upgrade by running `init` with the
newer CLI.

New to Taskless? Run `./.taskless/bin/cli.mjs onboard` after installing. It
walks your agent through your codebase and suggests a starter set of rules.

## How to Use via Agents

Installing adds one skill (`taskless`). The skill body is a small router: your
agent fetches the canonical recipe for whatever you asked for, then follows it.
Ask in plain language: "write a taskless rule that bans console.log", "add
taskless to CI", "run taskless check". You rarely need to run the CLI yourself.

To see what the agent sees, run `./.taskless/bin/cli.mjs agent` for the topic
index, or `./.taskless/bin/cli.mjs agent <topic>` for a full recipe.

## Taskless Check (CI and Constraints)

`taskless check` runs your rules against the codebase. It exits `0` when nothing
error-severity matched and `1` when something did, so it drops straight into a
pipeline:

```bash
./.taskless/bin/cli.mjs check                                   # scan everything
./.taskless/bin/cli.mjs check $(git diff --name-only main...HEAD)  # PR-only scan
./.taskless/bin/cli.mjs check --json                            # machine-readable
```

Paths that no longer exist are dropped silently, so raw `git diff` output can be
piped in without pre-filtering. Static rules need no login and make no network
calls, so CI needs no secrets. Runtime rules (which execute code) only run once
the server has verified their signature; otherwise they are reported as skipped
and never change the exit code.

Ask your agent to "add taskless to CI" and it will wire this into the CI
system you already use rather than replacing it.

## Why Teams Choose Taskless

- **Constraints, not suggestions.** Rules are real files in your repo, enforced
  by ast-grep, Vale, and runtime checks: the same result every run, for every
  agent and every human.
- **The same rules in the editor and in CI.** One command, one exit code.
- **Works with the agent you already have.** One skill installs into Claude Code,
  Cursor, Codex, and OpenCode, with a plain `.agents/` fallback when none is
  detected.
- **Nothing to run locally.** No daemon, no install step in CI, no auth for the
  checks that matter most.

## Docs

- [docs.taskless.io](https://docs.taskless.io): guides and reference
- [taskless.io](https://taskless.io): the product
- [github.com/taskless/cli](https://github.com/taskless/cli): source and issues

<details>
<summary><strong>Other</strong></summary>

### Telemetry

The CLI reports anonymous usage (which command ran, whether it succeeded, how
long it took, and counts of findings). It never sends rule content, prompts, or
matched source. Disable it by setting an environment variable:

```bash
export TASKLESS_TELEMETRY_DISABLED=1
```

Or turn it off for the whole project by adding a top-level `"telemetry": false`
to `.taskless/taskless.json`, beside the fields already there. The file is
checked in, so this disables telemetry for everyone working in the repository,
CI included.

With any of these set, no client is created and no network request is made.

</details>

---

MIT licensed.
