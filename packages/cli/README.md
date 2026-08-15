# @taskless/cli

> A Work in Progress

CLI companion for [Taskless](https://taskless.io). Designed to be invoked by skills via `npx` or `pnpm dlx`. Useful for agents, and works for humans too.

## Usage

```bash
# npm
npx @taskless/cli@latest info

# pnpm
pnpm dlx @taskless/cli@latest info
```

## Commands

### `taskless info`

Outputs CLI version, tool status, and login info as JSON to stdout:

```json
{
  "version": "0.0.3",
  "tools": [],
  "loggedIn": true,
  "auth": { "user": "jake", "email": "jake@example.com", "orgs": ["my-org"] }
}
```

### `taskless init`

Launches an interactive wizard that detects supported tool directories in the
current project (`.claude/`, `.opencode/`, `.cursor/`, `.agents/`), asks which
tools to enable Taskless for, and walks through the auth tradeoff before
writing anything. Running `taskless` with no subcommand in a TTY also launches
this wizard. Without a TTY, bare `taskless` prints a short context preamble
followed by the topic index from `taskless agent`.

In v0.7+, there is exactly one skill (`taskless`) and one command (`tskl`) —
no opt-in selection needed.

The skill and command content is written **once** to a canonical store in
`.taskless/skills/` and `.taskless/commands/`. Each enabled tool directory
receives only a thin reference stub — an ordinary file with a delegating body,
never a symlink — so there is a single source of truth and no drift between
copies. Stale layouts from earlier versions (full per-tool copies, symlinks)
are converged into stubs automatically on the next `init`/`update`.

For CI and scripted installs, pass `--no-interactive` to skip all prompts:

```bash
taskless init                    # interactive wizard (default in a TTY)
taskless init --no-interactive   # scripted install, no prompts
```

The wizard records what it installed in `.taskless/taskless.json` so later
runs can compute a diff and surgically remove files that are no longer
selected. Upgrading from v0.6 automatically removes the obsolete per-task
skills and commands during this diff. Cancelling the wizard at any step
(Ctrl-C) aborts cleanly with no filesystem changes.

### `taskless onboard`

Post-install discovery flow that helps a fresh user go from zero rules to a
useful starter set. Run it after `taskless init`. The CLI prints an
agent-facing recipe that walks the host AI tool through scanning the
codebase, agent-memory files (CLAUDE.md / AGENTS.md / .cursorrules),
recent PR review comments (when `gh` is available), and issue tracker
tickets (when a relevant MCP is wired in) for high-signal rule
candidates, then surfaces them as a bullet list the user can choose to
materialize via `taskless rule create`.

```bash
taskless onboard                  # print the recipe (refused if already complete)
taskless onboard --force          # re-run even when previously marked complete
taskless onboard --mark-complete  # record completion in .taskless/taskless.json
                                  # (invoked by the agent after explicit user
                                  # confirmation; never automatically)
```

Onboarding state lives in `.taskless/taskless.json` as
`install.onboarded` — a 3-state optional field (absent / `false` / `true`).
Only the agent writes it, and only with the user's explicit confirmation.
`taskless init` does not set it. Pass `--force` to re-run regardless of the
current value.

After a successful `taskless init`, the CLI prints a one-line trailer
pointing the user at this command. The trailer wording adapts to the
install plan: when the install included slash commands (Claude Code or
Cursor), it mentions `/tskl onboard` along with the Taskless skill and the
bare CLI; when the install only wrote skills (OpenCode, Codex, the
`.agents/` fallback), it mentions the skill and the bare CLI only.

### `taskless check`

Run ast-grep rules from `.taskless/sg/rules/` against the codebase. Exits with code 1 if any error-severity matches are found.

```bash
taskless check          # human-readable output, scans whole project
taskless check --json   # JSON output
```

Accepts optional positional path arguments to scan only specific files or
directories — useful for CI workflows that only want to check changed files.
Paths that don't exist on disk (e.g. files deleted in a diff) are silently
filtered, so raw git-diff output can be piped in directly:

```bash
taskless check src/foo.ts src/bar.ts
taskless check $(git diff --name-only main...HEAD)    # PR-only scan
taskless check $(git diff --cached --name-only)       # pre-commit scan
```

If every supplied path is missing, the command exits 0 with empty results.

### `taskless auth login` / `taskless auth logout`

Authenticate with taskless.io using the device flow. Tokens are stored in `~/.config/taskless/auth.json`.

### `taskless rule create`

Generate ast-grep rules via the taskless.io API. Reads a JSON request from stdin, submits it, polls for results, and writes rule and test files to `.taskless/sg/rules/` and `.taskless/sg/rule-tests/`.

```bash
echo '{"prompt": "detect console.log usage"}' | taskless rule create
echo '{"prompt": "find innerHTML assignments", "language": "typescript"}' | taskless rule create --json
```

Requires authentication and a `.taskless/taskless.json` with `orgId` and `repositoryUrl`.

### `taskless rule delete <id>`

Remove a rule file and its associated test files from disk. No authentication required.

```bash
taskless rule delete no-console-log
```

### `taskless --help`

Lists available subcommands.

### `taskless agent [topic]`

Returns agent-facing recipes. With no args, prints the topic index. With a
topic (e.g. `taskless agent route`), prints the full step-by-step recipe
for that operation, including an embedded JSON Schema for any `--from` input
and a table of stable error codes. Append `--anonymous` to fetch the
local-only variant where one exists (currently `rule create`/`rule improve`).

Recipes are how the consolidated `taskless` skill stays small while still
covering every operation — the skill body is a router that fetches the
relevant recipe on demand.

### `--anonymous` flag

Recognized on every command. Behavior matrix:

- `rule create` / `rule improve` — exits with a pointer to
  `taskless agent <topic> --anonymous`. The local-only flow runs in the agent
  per the recipe variant.
- `info` — skips the API/auth probe; reports local state only.
- `auth login` — rejected (auth commands cannot be anonymous).
- All others — accepted as no-op.

## For skill authors

Skills should detect the package manager by checking for lock files and invoke the CLI accordingly:

1. If `pnpm-lock.yaml` exists, use `pnpm dlx @taskless/cli@latest <command>`
2. Otherwise, use `npx @taskless/cli@latest <command>`

All commands output structured JSON to stdout by default. Parse with `JSON.parse()` and handle non-zero exit codes as errors.

## Developing

### Testing

```bash
pnpm --filter @taskless/cli test                  # run the suite once
pnpm --filter @taskless/cli exec vitest           # watch mode
```

The suite runs entirely locally under vitest — no network, no auth, no agent.
Integration tests that exercise the built binary (for example `detect`) run
against `dist/`, so run `pnpm --filter @taskless/cli build` first (or after any
source change) before invoking them directly.

**Two kinds of test, one of which is not fully automatable.** Most tests are
deterministic unit/integration checks. The route-honesty dataset
(`test/fixtures/route-eval.json`) is different: the actual routing decision is
made by an _agent_ following `help/route.txt`, so it cannot be asserted by a
code classifier. The automated test (`test/route-eval.test.ts`) therefore only
**guards the dataset** — that it stays structurally valid and balanced across
every route and both failure directions (over-claim / over-escalate). Running
the dataset _as an evaluation_ — feeding each case to an agent and scoring its
chosen destination — is a separate, manual calibration step with more setup; it
is not part of `pnpm test`. Keep the two distinct: the suite proves the fixtures
are well-formed; an agent run proves the recipe routes honestly.

### API base URL

The CLI resolves the API base URL in this order:

1. `TASKLESS_API_URL` env var
2. `~/.config/taskless/config.json` → `apiUrl` field
3. Default: `https://app.taskless.io/cli`

For local development against the taskless.io app:

```bash
TASKLESS_API_URL=http://localhost:5173/cli taskless info
```

### API schema introspection

All `/cli/api/*` endpoints support the `x-explain: 1` header. When present, the endpoint returns its JSON schema instead of executing — no authentication required.

```bash
# List available endpoints
curl -s -H "x-explain: 1" http://localhost:5173/cli/api

# Get the schema for rule generation
curl -s -H "x-explain: 1" -X POST http://localhost:5173/cli/api/rule

# Get the schema for rule status polling
curl -s -H "x-explain: 1" http://localhost:5173/cli/api/rule/any-id

# Get the schema for whoami
curl -s -H "x-explain: 1" http://localhost:5173/cli/api/whoami
```

This is useful for verifying that CLI types align with the production API contract.
