## Why

A reference stub is the only Taskless file most agents ever discover. Its body
is two sentences: this is a stub, read the canonical file. When the canonical
file is not on disk, the agent does not fail to find a skill. It finds the
skill, follows it to a path that does not exist, and the stub says nothing
about what to do next.

Two ordinary situations produce that state. An install writes untracked files,
so a second worktree created before they are committed has the stub and not the
canonical file. And a project that ignores `.taskless/skills/`, as this
repository does because it builds the CLI, commits the stub and never the
canonical file, permanently.

The recovery already exists: running the CLI reinstalls the scaffold. It is
not advertised at the one moment a reader needs it.

## What Changes

- **Both stub builders emit a recovery sentence.** Skill stubs and command
  stubs gain one line naming the command that restores the canonical file.
- **The command is the build's own.** The sentence is written in the published
  `npx @taskless/cli` form and passed through the same invocation rewrite that
  canonical content uses, so a `dev`/`self` build names its own binary and a
  nightly names the nightly rather than the released package.
- **`init`, not a bare run.** A bare invocation installs only from a TTY; in a
  non-interactive context it prints a preamble and hands off to `agent`, which
  is exactly the context an agent reading a stub is in. `init` installs in
  both.
- **A one-time rewrite for stubs already on disk.** Install rewrites a stub
  whose body predates the instruction, detected on a build-independent
  fragment so a prod build and a `dev` build never rewrite each other's stubs.

Stub content still carries nothing that varies per release, so the footprint
outside `.taskless` moves once and then stays put.

**Delivery is a single PR.** Two builders, one install predicate, tests, and a
spec delta.

## Capabilities

### Modified Capabilities

- `cli-init`: a reference stub tells the reader how to restore a canonical file
  that is missing, rather than ending at a path that does not exist.

## Impact

- **Modified**: `packages/cli/src/install/canonical.ts` (the recovery sentence
  and the migration predicate), `packages/cli/src/install/install.ts`
  (`referenceNeedsRewrite`), `packages/cli/test/canonical-store.test.ts`,
  `packages/cli/test/apply-install-plan.test.ts`.
- **Modified**: `.agents/skills/taskless/SKILL.md`, this repository's own
  committed stub, which is a live instance of the second situation above.
- **Unchanged**: stub frontmatter, which still carries no version, and the
  canonical store, which is unaffected.

**Tracking:** taskless/cli#200
