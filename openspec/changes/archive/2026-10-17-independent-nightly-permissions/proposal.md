## Why

Testing a nightly next to the release is awkward because each one undoes the other's permissions. Installing `@taskless/cli-nightly` in a project removes the `Bash(npx @taskless/cli@<version> *)` rule the release wrote, since every Taskless rule that is not the installed invocation's is treated as stale. Running the release again removes the nightly's rule. A project used with both builds never holds a rule for the one about to run.

Claude Code's user-level `autoMode.allow` entry has the same flaw, latent until the wording next changes. Both builds find the entry by one label, `Taskless CLI:`, and treat any labelled text other than their own as stale. The first nightly that rewords the entry will offer to replace the release's text, and the release will offer to put it back, on every run of either.

## What Changes

- **A project permission file holds one Taskless rule set per package.** A Taskless rule belongs to the package its command names. `init` removes stale rules only for the package it is installing (`@taskless/cli` or `@taskless/cli-nightly`), and never touches the other package's rules. The manifest record keeps the other package's recorded rules, so neither build loses track of a file it created. A build whose invocation names neither package (`self`, a repository path) removes no npx Taskless rules.
- **Each package has its own global trust entry.** The release entry keeps the label `Taskless CLI:` and names only `@taskless/cli`. The nightly entry has the label `Taskless CLI nightly:` and names only `@taskless/cli-nightly`. A build reads, offers, replaces, and warns about only its own entry, and never reads the other label as stale. **BREAKING** for the current spec, which requires one text that names both packages in every build. Once, on the first release that carries this, an existing `Taskless CLI:` entry naming both packages reads as stale, and the wizard offers to replace it.
- **The installed skill carries the installing build's entry.** The skill source spells the label and the entry as placeholders, which install renders for the build, as it already does for the invocation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-init`: what counts as a Taskless rule to remove is scoped to the installing package, and the manifest record keeps the other package's rules.
- `agent-global-trust`: one entry and label per package instead of one shared entry.
- `skill-taskless`: the classifier fallback names this build's label and entry rather than a fixed one.

## Impact

- `packages/cli/src/install/permissions.ts`: package-scoped removal and record carry-over in `syncPermissions()`.
- `packages/cli/src/install/global-trust.ts`: per-build label and entry, and a renderer for the skill placeholders.
- `packages/cli/src/install/canonical.ts`: renders the trust placeholders into the canonical skill.
- `skills/taskless/SKILL.md`: the label and entry become placeholders.
- `packages/cli/src/agent/init.md`: the stale state names this build's label.
- Tests: `permissions.test.ts` (or the existing permission suite), `global-trust.test.ts`, `installed-documentation.test.ts`, and a nightly-project test for the nightly entry.
- Delivery shape: **single PR**. Both halves are the same idea, applied to two files, and fit in one review.
