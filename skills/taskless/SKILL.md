---
name: taskless
description: |
  Use for any Taskless task. Trigger when the user mentions Taskless by name,
  or when their request involves the .taskless/ directory or files in it
  (rules, rule-metadata).

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
  `npx @taskless/cli agent route`; it does NOT suppress the skill.
metadata:
  author: taskless
  version: 0.11.1
  commandName: tskl
compatibility: Designed for Agents implementing the Agent Skills specification.
---

# Taskless

You do NOT have the steps for any Taskless action in your context. The current
canonical recipes live behind `npx @taskless/cli agent <topic>`. Always fetch
the recipe first; do not improvise from prior knowledge — recipes change with
each CLI version.

## Authoring a rule: always start at route

For any request to add/write/create a rule — whether or not the user names a
tool (eslint, ruff, biome, stylelint, ast-grep) — fetch `npx @taskless/cli agent route`
and follow it. Do NOT fetch a `create-*-rule` topic directly, and do NOT author from
your own linter knowledge. `route` runs `detect`, reasons about the request,
and decides whether the rule is built in a linter the repo already uses
(`create-legacy-rule`), as a local ast-grep rule (`create-sg-rule`), or via
the Taskless service (`create-remote-rule`) — and it
keeps the work local before any login. This skill is a thin router: all
authoring judgment lives in the fetched recipes.

## Confirm Taskless is installed when a path needs it

`route` and the `create-legacy-rule` path only read the repo, so they need no
install. If routing lands on a local Taskless rule (`create-sg-rule`) or the
service (`create-remote-rule`) and
the working directory has no `.taskless/` directory, offer to run
`npx @taskless/cli` to install. If the user only wanted help with their own
linter, the `create-legacy-rule` path needs nothing installed.

## Topics

| User wants                 | Topic                                  |
| -------------------------- | -------------------------------------- |
| Author/create a rule       | `npx @taskless/cli agent route`        |
| First-time install         | tell user to run `npx @taskless/cli`   |
| Update an existing install | tell user to run `npx @taskless/cli`   |
| Fix rules after an upgrade | `npx @taskless/cli update`             |
| Discover candidate rules   | `npx @taskless/cli agent onboard`      |
| Improve an existing rule   | `npx @taskless/cli agent improve-rule` |
| Delete a rule              | `npx @taskless/cli agent delete-rule`  |
| Check code against rules   | `npx @taskless/cli agent check`        |
| Log in, log out, or status | `npx @taskless/cli agent auth`         |
| Wire into CI               | `npx @taskless/cli agent ci`           |

Two of those rows look alike and are not. Running `npx @taskless/cli`
migrates the `.taskless/` layout and refreshes the installed skills: that is
the DIRECTORY, and it is automatic. `npx @taskless/cli update` is about the
RULES already in the project, which no migration can rewrite for you, since a
rewriter that now needs a `fix` or a rule whose matching semantics shifted
under a new engine is a question about content rather than layout.

An agent that has run a migration and watched it succeed will otherwise
reasonably conclude the upgrade is finished. The directory is migrated; the
rules may still need work, and `update` is how to find out.

If the user's intent is ambiguous between two topics, run
`npx @taskless/cli agent` (no args) to see the disambiguation table, or ask
the user.

## --anonymous

Any rule/check command accepts `--anonymous` to skip the Taskless API and
use local-only behavior. When the user is offline OR explicitly asks for
anonymous mode, fetch the recipe with
`npx @taskless/cli agent <topic> --anonymous`, which returns the local-only
flow (when one exists for that topic).

## First-run latency

The first invocation of `npx @taskless/cli` on a machine pays an npm
cold-fetch (~5–15 seconds). This is normal — do not report it as a timeout
or failure. Subsequent invocations are cached and fast.
