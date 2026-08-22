# @taskless/cli

[![npm](https://img.shields.io/npm/v/@taskless/cli)](https://www.npmjs.com/package/@taskless/cli)
[![build](https://img.shields.io/github/actions/workflow/status/taskless/cli/validate.yml?branch=main)](https://github.com/taskless/cli/actions/workflows/validate.yml?query=branch%3Amain)
[![nightly](https://img.shields.io/badge/nightly-npm-blue)](https://www.npmjs.com/package/@taskless/cli-nightly)
[![vale](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/taskless/cli/main/.shields/vale.json)](https://github.com/errata-ai/vale/releases)
[![sg](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/taskless/cli/main/.shields/sg.json)](https://github.com/ast-grep/ast-grep/releases)

CLI companion for [Taskless](https://taskless.io). Designed to work with agent skills to add constraints that improve coding agent output.

## Install

```bash
# npm
npx @taskless/cli

# pnpm
pnpm dlx @taskless/cli
```

Run with no arguments in a terminal to launch the installer, which detects the
agent tools in your project (Claude Code, Cursor, OpenCode) and installs into
each of them. For scripted installs, skip the prompts:

```bash
npx @taskless/cli init --no-interactive
```

New to Taskless? Run `npx @taskless/cli onboard` after installing — it walks your
agent through your codebase and suggests a starter set of rules.

## How to Use via Agents

Installing adds one skill (`taskless`) and one slash command (`/tskl`). The skill
body is a small router: your agent fetches the canonical recipe for whatever you
asked for, then follows it.

```
/tskl create a rule that bans console.log
/tskl add taskless to CI
```

Plain language works too — "write a taskless rule for X", "run taskless check",
"taskless login" all engage the skill. You rarely need to run the CLI yourself.

To see what the agent sees, run `npx @taskless/cli agent` for the topic index, or
`npx @taskless/cli agent <topic>` for a full recipe.

## Taskless Check (CI and Constraints)

`taskless check` runs your rules against the codebase. It exits `0` when nothing
error-severity matched and `1` when something did, so it drops straight into a
pipeline:

```bash
npx @taskless/cli check                                   # scan everything
npx @taskless/cli check $(git diff --name-only main...HEAD)  # PR-only scan
npx @taskless/cli check --json                            # machine-readable
```

Paths that no longer exist are dropped silently, so raw `git diff` output can be
piped in without pre-filtering. Static rules need no login and make no network
calls, so CI needs no secrets. Runtime rules — which execute code — only run once
the server has verified their signature; otherwise they are reported as skipped
and never change the exit code.

Ask your agent to `/tskl add taskless to CI` and it will wire this into the CI
system you already use rather than replacing it.

## Why Teams Choose Taskless

- **Constraints, not suggestions.** Rules are real files in your repo, enforced
  by ast-grep, Vale, and runtime checks — the same result every run, for every
  agent and every human.
- **The same rules in the editor and in CI.** One command, one exit code.
- **Works with the agent you already have.** One skill installs into Claude Code,
  Cursor, and OpenCode — plus the `/tskl` command wherever the tool supports slash
  commands — with a plain `.agents/` fallback when none is detected.
- **Nothing to run locally.** No daemon, no install step in CI, no auth for the
  checks that matter most.

## Docs

- [docs.taskless.io](https://docs.taskless.io) — guides and reference
- [taskless.io](https://taskless.io) — the product
- [github.com/taskless/cli](https://github.com/taskless/cli) — source and issues

<details>
<summary><strong>Other</strong></summary>

### Telemetry

The CLI reports anonymous usage — which command ran, whether it succeeded, how
long it took, and counts of findings. It never sends rule content, prompts, or
matched source. Disable it by setting either environment variable:

```bash
export TASKLESS_TELEMETRY_DISABLED=1
# or the cross-tool convention
export DO_NOT_TRACK=1
```

With either set, no client is created and no network request is made.

</details>

---

MIT licensed.
