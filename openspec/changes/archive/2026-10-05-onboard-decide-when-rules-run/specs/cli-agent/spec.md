## ADDED Requirements

### Requirement: hooks topic is registered

An agent topic `hooks` SHALL be registered. The CLI SHALL embed `packages/cli/src/agent/hooks.md` at build time via the existing `import.meta.glob` mechanism, and `taskless agent hooks` SHALL print it. The topic SHALL be classified as internal to the CLI rather than exported from `@taskless/cli/prompts`, since it walks an agent through editing a developer's repository.

The recipe SHALL describe running `check` on the staged files before a commit, in the hook tool the repository already uses, and SHALL NOT install a hook manager without asking the user first. It SHALL direct the agent to the `hooks` field of `taskless detect --json` for which tools the repository has.

The recipe SHALL be accurate about `check`'s behavior where a hook depends on it:

- `check` accepts file paths and skips paths that do not exist, so a staged-file list that includes deleted files can be passed directly, and a hook SHALL exit cleanly rather than run a full scan when the staged list is empty.
- `check` edits no tracked file. Where the recipe offers lint-staged's `--no-stash` on that basis, it SHALL also state that the flag makes lint-staged check a partially staged file as it is in the working tree rather than as it is staged.
- A staged change under `.taskless/rules/` SHALL be followed by `taskless test` and a full `check`, since a rule change can affect files that were not staged.

The recipe SHALL have the hook run the repository's own pinned `@taskless/cli` dev dependency rather than a download-and-run launcher, so the hook, CI and every developer run one version.

#### Scenario: The hooks topic returns the recipe

- **WHEN** a user runs `taskless agent hooks`
- **THEN** the CLI SHALL print the contents of `hooks.md` to stdout
- **AND** SHALL exit with code 0

#### Scenario: The hooks topic is internal

- **WHEN** the topic classification in `@taskless/cli/prompts` is read
- **THEN** `hooks` SHALL be listed among the internal topics
- **AND** SHALL NOT be an exported prompt topic

#### Scenario: The recipe states the cost of --no-stash

- **WHEN** `hooks.md` mentions lint-staged's `--no-stash`
- **THEN** it SHALL state that a partially staged file is then checked as it is in the working tree

#### Scenario: A rule change triggers test and a full check

- **WHEN** `hooks.md` is read
- **THEN** it SHALL instruct the agent to run `taskless test` and an unscoped `check` when a staged path is under `.taskless/rules/`
