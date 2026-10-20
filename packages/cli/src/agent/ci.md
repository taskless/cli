# Topic: ci     (CLI v%(CLI_VERSION)s / topic v7)

%(ONE_COMMAND_PER_CALL)s

## Goal
Wire `%(TASKLESS_CLI)s check` into the user's existing CI so rules run
automatically on pushes and pull requests. Integrate with what they
already have, never replace or edit their main pipeline.

This recipe teaches two patterns (full scan and diff scan) that
translate to any CI system. Common systems are listed as hints; if
you recognize one not on the list, apply the same patterns.

## Preconditions
- `.taskless/` directory exists and contains at least one rule. (If
  no rules exist, instruct the user to fetch
  `%(TASKLESS_CLI)s agent route` first, wiring CI with zero rules
  produces an always-green check that gives false confidence.)
- A local `%(TASKLESS_CLI)s check` succeeds (or fails with real findings the
  user is OK with seeing in CI's first run).
- `.taskless/bin/cli.mjs` exists and is committed. It is the project
  launcher `init` writes, and it runs the CLI version recorded in
  `.taskless/taskless.json`, so CI runs the same version the project
  was installed with and an upgrade reaches CI in the same commit that
  updates `.taskless/`. If it is missing, the project was installed by
  an older CLI: tell the user to run `%(TASKLESS_CLI)s init` and commit
  the result first. If only `.taskless/bin/cli-nightly.mjs` exists, the
  project runs a nightly; ask whether CI should run that nightly, and if
  so use `cli-nightly.mjs` wherever this recipe says `cli.mjs`.
- No auth required for CI: `check` is unauthenticated by default.
  (Optionally tokenized as a server-enforced backstop; see step 7.)

## Steps

### 1. Discover the user's CI system

Start from `%(TASKLESS_CLI)s detect --json`: its `ci` field names the CI
systems configured at the repository root, with the files that matched.
It recognizes the systems below. If it reports none, or you recognize a
system it does not, look at the repo root yourself:

| File / directory          | CI system           |
|---------------------------|---------------------|
| `.github/workflows/*.yml` | GitHub Actions      |
| `.gitlab-ci.yml`          | GitLab CI           |
| `.circleci/config.yml`    | CircleCI            |
| `Jenkinsfile`             | Jenkins             |
| `azure-pipelines.yml`     | Azure Pipelines     |
| `bitbucket-pipelines.yml` | Bitbucket Pipelines |
| `.buildkite/`             | Buildkite           |
| `.drone.yml`              | Drone               |
| `.travis.yml`             | Travis CI           |

Sum up what you found and confirm with the user. If zero match, ask
which CI they use. If multiple match, ask which should run Taskless.

### 2. Agree on the scan pattern

- **Full scan**: `%(TASKLESS_CLI)s check`. Scans everything. Best for runs
  on the main/default branch.
- **Diff scan**: `%(TASKLESS_CLI)s check $(git diff --name-only ...)`.
  Faster for PR builds. Per-CI diff target var:

| CI                  | Target branch variable                        |
|---------------------|-----------------------------------------------|
| GitHub Actions      | `github.base_ref`                             |
| GitLab CI           | `CI_MERGE_REQUEST_TARGET_BRANCH_NAME`         |
| CircleCI            | `CIRCLE_BRANCH` (fetch main and diff against) |
| Jenkins             | `env.CHANGE_TARGET`                           |
| Azure Pipelines     | `System.PullRequest.TargetBranch`             |
| Bitbucket Pipelines | `BITBUCKET_PR_DESTINATION_BRANCH`             |

  `%(TASKLESS_CLI)s check` skips paths that don't exist (naming them in a
  notice), so raw `git diff --name-only` output can pipe in directly.
  Run it from the repository root: `git diff` paths are relative to the
  root, and a path outside the project is refused.

**Recommended default:** diff scan on PRs, full scan on pushes to
main.

### 3. Verify locally first

Run `%(TASKLESS_CLI)s check`:
- Clean pass → proceed.
- "No rules configured" → stop. Fetch `%(TASKLESS_CLI)s agent route`.
- Findings → tell the user CI will fail; ask whether to fix,
  suppress, or proceed knowing the first CI run will be red.
- Runtime rules withheld for the plan (a notice with an upgrade URL,
  or `entitlement.withheld` under `--json`) → tell the user CI will
  fail until the organization's plan includes runtime rules. This is
  not a findings failure and editing the rules will not fix it. Do not
  add `--anonymous` or `--dangerously-run-scripts` to the CI command to
  get green; both hide that the rules are not running.
- A rule reported as edited (`failures` names it; `integrity` lists it
  as `unsafe`) → CI will fail until it is put back. Run
  `%(TASKLESS_CLI)s rule restore <ruleId>`; do not edit it back by hand
  and do not add a flag to the CI command to skip verification.

### 4. Generate the config

Rules:
1. Write a NEW standalone file. Never modify the user's existing
   CI config.
2. Prefer the CI's native include mechanism. Tell the user the one
   line they need to add to their main config.
3. If the file you'd write already exists, ask before overwriting.

Canonical paths:

| CI                  | File path                                                           |
|---------------------|---------------------------------------------------------------------|
| GitHub Actions      | `.github/workflows/taskless.yml` (standalone, no include needed)    |
| GitLab CI           | `.taskless/ci/gitlab.yml` (user adds `include`)                     |
| CircleCI            | `.taskless/ci/circleci-job.yml` (no include, user copies job)      |
| Jenkins             | `.taskless/ci/taskless.Jenkinsfile` (user `load()`s)                |
| Azure Pipelines     | `.taskless/ci/azure-taskless.yml` (user references via `template:`) |
| Bitbucket Pipelines | `.taskless/ci/bitbucket-pipelines.yml` (user merges manually)       |
| Other               | `.taskless/ci/<system>.<ext>` + clear wiring instructions           |

### 5. GitHub Actions reference template

The reference template, translate the same shape (checkout with
full history, set up Node, conditional check) for other CIs.

CI runs the launcher as `node .taskless/bin/cli.mjs`, from the
repository root, and never through `npx`, `pnpm dlx`, `yarn dlx`, or
`bunx`. `node <path>` rather than `./<path>`: a CI checkout can lose the
executable bit, and a Windows runner does not honour the launcher's
shebang. This is a different spelling from the one you run locally, on
purpose; do not copy it into your own commands.

```yaml
name: Taskless

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Taskless check
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            git fetch origin "${{ github.base_ref }}" --depth=1
            FILES=$(git diff --name-only "origin/${{ github.base_ref }}...HEAD")
            if [ -z "$FILES" ]; then
              echo "No changed files."
              exit 0
            fi
            node .taskless/bin/cli.mjs check $FILES
          else
            node .taskless/bin/cli.mjs check
          fi
```

Simplifications:
- Full-scan only → drop the `if`, just run `node .taskless/bin/cli.mjs check`.
- Diff-scan only → remove the `push:` trigger.

### 6. Translate to other CIs

The six universal steps:
1. Make Node available to the job (v22 or later; match the user's
   existing CI version when it is newer): the CI system's Node setup
   step, or a Node container image such as `node:22`. The Taskless job
   needs nothing else from the project's own toolchain, and no
   `package.json`, so in a Python, Go, or other non-Node repository it
   still runs as its own job with its own image.
2. Fetch with full depth (or enough to reach the target branch).
3. Fetch the target branch.
4. Compute changed files with `git diff --name-only "origin/<target>...HEAD"`.
5. Exit early if the diff is empty.
6. Call `node .taskless/bin/cli.mjs check $FILES` for PR builds, or
   `node .taskless/bin/cli.mjs check` for main-branch builds.

YAML for GitHub/GitLab/Azure/Bitbucket; Groovy for Jenkins;
different structure for CircleCI. The six steps stay the same.

### 7. Authentication in CI (optional backstop)

`%(TASKLESS_CLI)s check` does NOT require authentication. The generated CI
config works out of the box with no secrets and scans all local rules.

Static ast-grep and Vale rules always run in CI with no secrets.
**Runtime rules** (`.taskless/rules/runtime/`, which execute a
`check.ts`) only run when their code is server-verified, so an
unauthenticated CI job runs the static rules and skips the runtime ones.

Exposing a `TASKLESS_TOKEN` secret turns CI into the **backstop**: an
authenticated `check` verifies every file of every rule against what
Taskless issued. Runtime rules run only when verified. An issued
ast-grep or Vale rule that was edited does not run and fails the job,
so a rule loosened to let its own violation through cannot pass CI.
Without the token neither check happens, which is why this is the
enforcement point; local developer runs skip runtime rules unless
`--dangerously-run-scripts` is passed. To wire it, set
the token as an env var on the check step (GitHub Actions):

```yaml
      - name: Taskless check
        env:
          TASKLESS_TOKEN: ${{ secrets.TASKLESS_TOKEN }}
        run: |
          ...
```

Add this only when the user wants server-enforced rules in CI; the
unauthenticated default remains fully supported. Also mention auth if
the user explicitly asks to run authenticated commands (e.g.
`rule create`/`rule improve`) in CI, uncommon.

### 8. Repositories that are not Node projects

The job needs Node and nothing else. When the repository's main
pipeline runs in an image without Node (a `python:3.12` image, for
example), keep Taskless in its own job with a Node image or setup step,
rather than installing Node into the main job. Do not add a
`package.json`, and do not add `@taskless/cli` as a dependency: the
launcher already pins the version through `.taskless/taskless.json`.

### 9. Report back

Show:
1. The path written and a 10-15 line excerpt.
2. For CIs needing manual wiring, the exact `include:` / reference
   line for their main config.
3. `git status` so they can review before committing.
4. A note that the first CI run exercises rules, if existing
   matches exist, CI will fail until fixed or suppressed.

## Errors

- **No rules** → fetch `%(TASKLESS_CLI)s agent route`. Don't write CI
  config.
- **Unrecognized CI** → produce a generic `.taskless/ci/check.sh`
  script implementing the six universal steps. Be upfront it's a
  starting point.
- **Target CI file exists, user declines overwrite** → stop. Show
  what you would have written; let them reconcile manually.

## See Also

- `%(TASKLESS_CLI)s agent check`: the command being wired into CI
- `%(TASKLESS_CLI)s agent route`: required if no rules exist yet
- `%(TASKLESS_CLI)s agent hooks`: run `check` on staged files before a commit, too
