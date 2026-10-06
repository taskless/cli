## Context

Onboarding ends with rules on disk. Whether those rules ever run depends on CI or a commit hook calling `check`, and the onboard recipe never raised either. The `ci` topic existed but nothing pointed to it from onboarding, and no topic covered a local hook.

## Goals / Non-Goals

**Goals:**

- The onboard flow asks when the rules run before it asks about `--mark-complete`, and never puts the two questions in one message.
- The agent starts from facts the CLI measured (which CI systems and which hook tools are configured) rather than re-deriving them by listing files.
- A recipe for the pre-commit case that is right about `check`'s actual behavior.

**Non-Goals:**

- Installing a hook manager. The recipe wires `check` into the tool the repository already uses, and asks before introducing one.
- Telling whether an existing CI workflow already runs Taskless. That needs reading workflow contents for intent, which is the agent's job, not a deterministic signal.
- Detecting raw `.git/hooks/*` scripts or `core.hooksPath`. Neither is committed, so neither is shared configuration the scan can stand on.

## Decisions

### `detect` reports `ci` and `hooks` as `{ name, evidence }` lists

Same shape as `linters`, so a consumer already handling one handles all three. `evidence` carries the path or the `package.json` marker that triggered the match, which keeps the "every signal is attributable" property `linters` has.

**CI is matched at the scan root only.** CI systems read their config from the repository root, so a `.gitlab-ci.yml` three directories down is a fixture or a vendored project, not this repository's CI. The monorepo-wide walk is right for linter configs and wrong here.

**Hook tools are matched at the scan root too**, for the same reason: git runs one set of hooks per repository, installed from the root. A root `package.json` dependency or config key counts; a sub-package's does not.

lint-staged is reported beside the hook managers even though it is not one. It is what turns "run on commit" into "run on the staged files", which is the question the onboard step asks, and leaving it out would hide the most common way that question is already answered.

Rejected: a single `automation` field mixing both. The onboard step offers CI and hooks as two separate choices, and the `ci` and `hooks` topics each read one list.

### The hook runs the repository's pinned binary, spelled `<local-taskless>`

A hook should run the version the repository pins as a dev dependency, so the hook, CI and every developer agree. That is a different binary from `%(TASKLESS_CLI)s` (how this recipe was fetched) and from `%(PACKAGE_MANAGER_DLX)s` (a download-and-run launcher, which defeats the pin). The recipe names it with an agent-fill marker, `<local-taskless>`, and lists once what it expands to per package manager. Because the marker is never followed by a literal subcommand, the cross-reference guard that rejects hand-written invocations has nothing to flag and needs no allowlist entry, unlike `ci.md`'s `pnpm taskless check`.

Rejected: a new sprintf placeholder resolved at render time. The CLI cannot know the target repository's package manager at render time any better than the agent can by looking at the lockfile, and a value guessed at render time reads as measured.

### `--no-stash` is presented with its cost

`check` edits no tracked file (its working files go under `.taskless/.run/` and are removed when the run ends), so lint-staged's backup stash protects nothing for a `check`-only task, and that stash goes on the stack every worktree shares. But lint-staged documents that `--no-stash` also implies `--no-hide-partially-staged`, so a partially staged file is checked as it is in the working tree, not as it is staged. The recipe states both and leaves the trade to the user rather than recommending the flag unconditionally.

### Step order in onboard

The new step sits after materialization (there must be rules to run) and before the mark-complete question. The mark-complete question keeps its existing consent wording and gains one constraint: it is asked in a message that asks nothing else.

## Risks / Trade-offs

- [A hook tool's config syntax drifts] → The recipe gives the shape per tool and tells the agent to check the tool's own docs for anything beyond it, rather than encoding version-specific detail.
- [`check $FILES` word-splits paths with spaces] → Same limitation the `ci` recipe already carries. lint-staged and pre-commit hand the file list to the command themselves, so the shell-substitution forms (bare husky, simple-git-hooks) are the ones exposed, and the recipe says so.
