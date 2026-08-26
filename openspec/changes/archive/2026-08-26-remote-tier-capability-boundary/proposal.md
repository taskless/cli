## Why

A GitHub `origin` remote is enforced as a **precondition** on `rule create` and `rule improve`. A project without one is told its setup is broken rather than that a single tier is unavailable, and the message reads as an auth or configuration failure. A field report (Linear TSKL-291) hit this on an Obsidian vault of markdown notes that is not a git repository at all: combined with the missing markdown support since fixed by #182, that project had no authoring path of any kind.

A GitHub remote should gate exactly one thing: remote rule generation. Local authoring, `verify`, `test`, and `check` need no verifiable org identity and already work without one. The requirement is legitimate; its scope and framing are not.

Coupled with this, telemetry cannot presently answer which GitHub owners use the product, because the owner is never recorded. Both concerns read the same value out of the git remote, so they are changed together rather than touching that resolution path twice.

## What Changes

- **Remote generation reports a capability boundary, not a broken setup.** `rule create` and `rule improve` still fail without a GitHub remote, because they submit to the generation API and genuinely need an org identity. The failure names the reason, distinguishes itself from an auth failure, and points at the local authoring path that does work.
- **The three failure populations get distinct error codes.** Today "not a git repository", "a git repository with no `origin`", and "an `origin` that is not GitHub" all collapse onto `NO_GITHUB_REMOTE`, so an agent cannot tell `git init` from "add a remote" from "GitLab is not supported". New codes are **added**; `NO_GITHUB_REMOTE` is retained, so this is not a breaking change to the agent contract.
- **`taskless info --json` reports the repository URL and GitHub owner.** No new subcommand and no new output format: `info` is already JSON and is already the command `route` consults for capability state, so the availability test and the enforcement read one resolution. `taskless auth` stays plain text.
- **Telemetry records `gh_owner`** whenever a GitHub owner can be extracted from the git remote, on authenticated and anonymous runs alike. Named `gh_owner` rather than `gh_org` deliberately: the first path segment of a GitHub URL is either an organization or a user account, and the CLI cannot distinguish them without a network call, so the accurate name is the one that does not assert which.
- **`route` stops offering remote generation** when no GitHub owner is identifiable, and the remote-generation recipe gains its own guard so the constraint still holds when `route` is bypassed.
- **Local generation is covered by tests** asserting it completes with no GitHub remote. This is existing behavior; nothing here changes it, and the tests exist to keep it that way.

## Capabilities

### New Capabilities

_None._ Every outcome modifies behavior that an existing capability already owns.

### Modified Capabilities

- `cli`: `info` reports `repositoryUrl` and `ghOwner` alongside `loggedIn`.
- `cli-auth`: identity resolution distinguishes the three no-remote populations rather than collapsing them.
- `analytics`: identify carries a `gh_owner` property whenever a GitHub owner is resolvable from the git remote, including for anonymous runs.
- `cli-rules`: remote generation reports its unavailability as a capability boundary naming the population, and local generation is guaranteed to work without a GitHub remote.
- `cli-rule-routing`: `route` omits remote generation from the paths it offers when no GitHub owner is identifiable.
- `cli-agent-authoring`: the remote-generation recipe guards the constraint independently of `route`.

## Impact

- `packages/cli/src/util/git-remote.ts` — resolution must report which population a failure belongs to. Distinguishing "not a git repository" from "no `origin`" needs an additional probe, since both fail the same `git remote get-url origin` invocation.
- `packages/cli/src/types/errors.ts` — new codes added to the `CLIErrorCode` union. Codes are a documented agent contract: adding is safe, renaming is breaking.
- `packages/cli/src/auth/identity.ts`, `packages/cli/src/commands/rules.ts` — the two `resolveIdentity` call sites, which are the only ones.
- `packages/cli/src/commands/info.ts` and its output schema — two additional fields on a payload that already exists. `commands/auth.ts` is unchanged.
- `packages/cli/src/telemetry.ts` — a property on `identify`, and on captured events.
- `packages/cli/src/agent/route.txt`, `packages/cli/src/agent/create-remote-rule.txt` — recipe guards.
- No change to `check`, `verify`, or `test`. `check` already degrades correctly when no remote is present and is the pattern the rest of this change follows.
