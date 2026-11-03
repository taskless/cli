## Why

`taskless agent ok` is the first Taskless command of every session, so it is the one place an agent is guaranteed to look. Today it only proves the CLI can run. A project can still be running a CLI several releases behind, carry skill files from another version, or owe a rules reconcile, and nothing tells the agent until a later command refuses or someone runs `info` by hand. Developers who run `check` locally, by hand or from a git hook, get no hint either.

## What Changes

- `ok` becomes a recipe, `packages/cli/src/agent/ok.md`, served like any other topic: it has the `# Topic:` header and the one-command-per-call paragraph. Its body is a passage the CLI fills from state it measures at fetch time:
  - When nothing is out of date: "Your Taskless environment is up to date and you can proceed."
  - Otherwise: "Your Taskless environment is out of date, the following steps are needed in order for commands to work reliably", followed by one numbered step per stale part, each naming what is stale, why it matters, and the exact command that fixes it.
- Three parts are measured, in this order:
  - **cli**: a newer version of this build's package is published as `latest`. It is asked of the npm registry alone with a 1s timeout, and the answer is accepted only as strict semver, since it ends up in a command the user runs. The lookup stays silent on failure, and is skipped in CI. `--anonymous` does not skip it: that flag means "skip the Taskless API", and the npm registry is not it.
  - **skill**: the installed skill is not the version this CLI carries, as `info` already reports.
  - **rules**: the rules owe a reconcile, as `info` and `init` already report.
- `ok` reads `.taskless/` but never writes it, and it always exits 0.
- `taskless check`, when not in CI, runs the same measurement alongside its scan and, when something is out of date, adds one notice saying so and naming the fix. That notice is a `Notice:` line in text output and an entry in `notices` under `--json`. It never changes the exit code or the results.
- The skill's preflight section tells the agent what the `ok` recipe's two outcomes mean. On out of date, the agent hands the steps to the user to run themselves (with `!` in Claude Code, or in another terminal), because a harness that blocks Taskless commands blocks these too, and then re-runs `agent ok` to confirm. Otherwise the preflight stays once per session.
- **BREAKING (output format)**: `agent ok` no longer prints the bare confirmation sentence. Its only consumer is the skill shipped in the same package.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-agent`: the "ok topic confirms the CLI can run" requirement changes from a built-in one-line confirmation to a recipe that reports whether the environment is up to date.
- `cli-check`: a new requirement for the out-of-date notice outside CI.
- `skill-taskless`: a new requirement that the skill acts on the `ok` recipe's out-of-date steps.

## Impact

- `packages/cli/src/agent/ok.md` (new) and `packages/cli/src/prompts/recipes.ts`: a new caller-measured passage variable, following the existing `HOST_TOOLS` pattern.
- A new freshness module (registry lookup plus the existing local checks), shared by `agent` and `check`.
- `packages/cli/src/commands/agent.ts`: the built-in `ok` branch is removed, and `ok` is served through the recipe path.
- `packages/cli/src/commands/check.ts`: the notice.
- `skills/taskless/SKILL.md`: the preflight section, with a skill version bump.
- The `agent ok` command line is unchanged, so the permission rules `init` writes still match.
- `agent ok` and local `check` gain one small GET to `registry.npmjs.org`, bounded by a 1s timeout. No other host is contacted.

## Delivery

Single PR: one recipe, one shared module, two command call sites, one skill paragraph, and their tests, within the ~1200-line guideline.
