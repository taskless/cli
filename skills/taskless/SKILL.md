---
name: taskless
description: |
  Use for any Taskless task. Trigger when the user mentions Taskless by name,
  or when their request involves the .taskless/ directory or files in it
  (rules, rule-tests, rule-metadata).

  Specifically:
  - "create/add/write a taskless rule for X"
  - "improve/fix/iterate on this taskless rule"
  - "delete/remove this taskless rule"
  - "run taskless", "taskless check", "validate against taskless rules"
  - "taskless login/logout/status", "is taskless connected"
  - "add taskless to CI", "wire taskless into github actions"
  - "onboard with taskless", "set up taskless for this project"

  Also trigger on any request to add/write/create a lint or code rule,
  including ones that name a specific tool (eslint, ruff, biome, stylelint,
  ast-grep). Naming a tool ENGAGES this skill's routing flow via
  `taskless agent route`; it does NOT suppress the skill.
metadata:
  author: taskless
  version: 0.10.2
  commandName: tskl
compatibility: Designed for Agents implementing the Agent Skills specification.
---

# Taskless

You do NOT have the steps for any Taskless action in your context. The current
canonical recipes live behind `npx @taskless/cli help <topic>`. Always fetch
the recipe first; do not improvise from prior knowledge — recipes change with
each CLI version.

## Authoring a rule: always start at route

For any request to add/write/create a rule — whether or not the user names a
tool (eslint, ruff, biome, stylelint, ast-grep) — fetch `npx @taskless/cli help route`
and follow it. Do NOT fetch `rule create` directly, and do NOT author from
your own linter knowledge. `route` runs `detect`, reasons about the request,
and decides whether the rule is built in an existing linter (`existing`), as a
local ast-grep rule (`static`), or via the Taskless service (`remote`) — and it
keeps the work local before any login. This skill is a thin router: all
authoring judgment lives in the fetched recipes.

## Confirm Taskless is installed when a path needs it

`route` and the `existing` path only read the repo, so they need no install. If
routing lands on a local Taskless rule (`static`) or the service (`remote`) and
the working directory has no `.taskless/` directory, offer to run
`npx @taskless/cli` to install. If the user only wanted help with their own
linter, the `existing` path needs nothing installed.

## Topics

| User wants                 | Topic                                 |
| -------------------------- | ------------------------------------- |
| Author/create a rule       | `npx @taskless/cli help route`        |
| First-time install         | tell user to run `npx @taskless/cli`  |
| Update existing install    | `npx @taskless/cli update`            |
| Discover candidate rules   | `npx @taskless/cli help onboard`      |
| Improve an existing rule   | `npx @taskless/cli help rule improve` |
| Delete a rule              | `npx @taskless/cli help rule delete`  |
| Check code against rules   | `npx @taskless/cli help check`        |
| Log in, log out, or status | `npx @taskless/cli help auth`         |
| Wire into CI               | `npx @taskless/cli help ci`           |

If the user's intent is ambiguous between two topics, run
`npx @taskless/cli help` (no args) to see the disambiguation table, or ask
the user.

## --anonymous

Any rule/check command accepts `--anonymous` to skip the Taskless API and
use local-only behavior. When the user is offline OR explicitly asks for
anonymous mode, fetch the recipe with
`npx @taskless/cli help <topic> --anonymous`, which returns the local-only
flow (when one exists for that topic).

## First-run latency

The first invocation of `npx @taskless/cli` on a machine pays an npm
cold-fetch (~5–15 seconds). This is normal — do not report it as a timeout
or failure. Subsequent invocations are cached and fast.
