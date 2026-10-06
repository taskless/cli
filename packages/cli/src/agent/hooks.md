# Topic: hooks     (CLI v%(CLI_VERSION)s / topic v1)

## Goal
Run `check` on the staged files before every commit, in the hook tool
the repository already uses, so a rule violation is caught before it
reaches a branch rather than after CI runs. This is the local half of
deciding when rules run. `%(TASKLESS_CLI)s agent ci` is the other half.

## Preconditions
- `.taskless/` exists and holds at least one rule. A hook with no
  rules passes every commit and says nothing, which reads as "checked
  and clean". If there are none, fetch `%(TASKLESS_CLI)s agent route`
  first.
- `%(TASKLESS_CLI)s check` succeeds locally, or fails only with
  findings the user has agreed to fix. Otherwise the hook blocks the
  very next commit.
- The user has agreed to a hook. A hook runs on every developer's
  commits, so it is a team decision, not a setup detail.

## Steps

### 1. Find the hook tool the repository already uses

```
%(TASKLESS_CLI)s detect --json
```

Read the `hooks` field. Each entry names a tool and the evidence that
matched:

| `hooks` entry      | Where the pre-commit command goes                         |
|--------------------|-----------------------------------------------------------|
| `lint-staged`      | its config: `.lintstagedrc*`, `lint-staged.config.*`, or the `lint-staged` key in `package.json` |
| `husky`            | `.husky/pre-commit`                                       |
| `lefthook`         | `lefthook.yml` (or its `.json`/`.toml` sibling), under `pre-commit` |
| `pre-commit`       | `.pre-commit-config.yaml`, as a `repo: local` hook        |
| `simple-git-hooks` | its config file or the `simple-git-hooks` key in `package.json` |

When `lint-staged` is present beside a hook manager, add the command
to lint-staged and leave the hook manager calling it as it already
does. When `hooks` is empty, ask the user which tool they want and do
not install one on your own initiative. A script placed directly in
`.git/hooks/` is not committed, so it runs only on the machine that
wrote it. Say so if the user asks for one.

### 2. Pin the CLI as a dev dependency

The hook runs the version the repository pins, so the hook, CI and
every developer agree on what `check` means. A download-and-run
launcher fetches whatever is newest at commit time instead.

If `@taskless/cli` is not already in `devDependencies`, offer to add
it with the repository's package manager (read the lockfile:
`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, or `package-lock.json`).

The examples below write `<local-taskless>` for that pinned binary.
Substitute the form that resolves it from the repository's own
`node_modules/.bin`:

- pnpm: `pnpm exec taskless`
- npm: `npx --no taskless`
- yarn: `yarn taskless`
- bun: `bun run taskless`

The npm form keeps `--no` on purpose: without it, npx downloads an
unrelated package named `taskless` when the dev dependency is missing,
rather than failing.

Inside a lint-staged task a bare `taskless` also resolves, because
lint-staged puts `node_modules/.bin` on the `PATH` for its tasks.

### 3. Write the pre-commit command

`check` accepts file paths and skips any that do not exist, so a staged
list that includes deleted files can go straight in. Called with no
paths at all it scans the whole project, so a hook that builds the list
itself has to exit early when the list is empty.

**lint-staged.** lint-staged appends the staged files that match the
glob to the command:

```json
{
  "*": "<local-taskless> check"
}
```

**lefthook.** `{staged_files}` expands to the staged list, and
lefthook skips the command when it is empty:

```yaml
pre-commit:
  commands:
    taskless:
      run: <local-taskless> check {staged_files}
```

**pre-commit.** pre-commit passes the staged filenames to `entry`:

```yaml
repos:
  - repo: local
    hooks:
      - id: taskless
        name: Taskless
        entry: <local-taskless> check
        language: system
        pass_filenames: true
```

**husky or simple-git-hooks without lint-staged.** Build the list
with git:

```sh
FILES=$(git diff --cached --name-only --diff-filter=ACMR)
[ -z "$FILES" ] && exit 0
<local-taskless> check $FILES
```

`$FILES` splits on whitespace, so a staged path containing a space
reaches `check` as two paths that do not exist, and is skipped. The
`ci` recipe has the same limitation. If the repository has paths
like that, prefer lint-staged.

For simple-git-hooks, rerun its installer after editing the config
(`<package-manager> simple-git-hooks`), or the change does not reach
`.git/hooks/`.

What the hook runs depends on the developer's login, as for any
`check` (see "What runs" in `%(TASKLESS_CLI)s agent check`). Logged
in, `check` verifies the rules with the Taskless service, a network
call on every commit, and runs the runtime rules that pass. Logged
out, it runs ast-grep and Vale rules and skips runtime ones. If that
network call makes commits too slow, `--anonymous` skips it, and with
it the runtime rules and the edited-rule check; that is the user's
call, and CI with a token stays the backstop. Never add
`--dangerously-run-scripts`: it executes rule code nobody verified,
on every commit.

### 4. Rerun everything when a rule changes

A staged change under `.taskless/rules/` changes what `check` means,
and it can affect files that were not staged. In that case run the
rule tests and a full, unscoped `check`:

```
<local-taskless> test
<local-taskless> check
```

lint-staged can express that in a JavaScript config, where a function
task receives the matched files and its returned commands are run as
written, with no files appended:

```js
export default {
  "*": "<local-taskless> check",
  ".taskless/rules/**": () => [
    "<local-taskless> test",
    "<local-taskless> check",
  ],
};
```

For the other tools, add a second command scoped to
`.taskless/rules/`, using the tool's own glob or file filter. Check
the tool's documentation for the exact key.

### 5. lint-staged and `--no-stash`

`check` edits no tracked file: its working files go under
`.taskless/.run/` and are removed when the run ends. So lint-staged's
backup stash protects nothing for a `check` task, and it goes on the
stash stack every git worktree of the repository shares, which
matters where several agents work in worktrees at once.

`--no-stash` skips that stash, but lint-staged documents that it also
implies `--no-hide-partially-staged`. A file with both staged and
unstaged edits is then checked as it is in the working tree, not as
it is staged, so a commit can pass on an edit it does not contain.
Present both sides and let the user choose. Do not add the flag
silently. If lint-staged also runs a formatter that rewrites files,
keep the stash: `--no-stash` would leave that formatter's changes
unprotected when the commit is aborted.

### 6. Verify

Stage a change and run the hook directly rather than committing:

- lint-staged: `<package-manager> lint-staged`
- lefthook: `<package-manager> lefthook run pre-commit`
- pre-commit: `pre-commit run`
- husky or simple-git-hooks: run the hook script, `sh .husky/pre-commit`

Confirm it scans the staged files, and that it exits 0 when nothing
is staged.

### 7. Report back

Show the file you changed and the lines you added, any dev dependency
you added, and `git status`. Do not commit on the user's behalf.

## Errors

- **No rules**: fetch `%(TASKLESS_CLI)s agent route`. Do not write a hook.
- **Local `check` fails**: fix, suppress, or agree with the user to
  leave it, before the hook goes in. A hook that fails on code nobody
  staged blocks every commit.
- **The user declines a hook**: stop. `check` then runs only in CI, if
  wired, or when someone runs it.

## See Also

- `%(TASKLESS_CLI)s agent check`: what `check` runs and what its exit codes mean
- `%(TASKLESS_CLI)s agent ci`: run `check` in CI as well
- `%(TASKLESS_CLI)s agent detect`: the `hooks` field this recipe starts from
