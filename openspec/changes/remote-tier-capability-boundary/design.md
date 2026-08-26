## Context

`resolveIdentity` resolves a token, then a repository URL, then an org subject. The repository URL comes from `git remote get-url origin`, canonicalized to `https://github.com/{owner}/{repo}`. Any failure throws `NO_GITHUB_REMOTE`.

It is called from exactly two places: `rule create` and `rule improve`. Both submit to the generation API with `repositoryUrl` in the payload, so both genuinely need an org identity. Nothing else in the CLI calls it.

The behavior this change wants **already exists elsewhere in the codebase.** `check` resolves the same URL and, on failure, degrades:

```
no GitHub remote — runtime rules could not be verified and did not run
```

Static checks still run; only the runtime tier is skipped, and the report says why. That is the capability boundary the remote tier should present, and it is the pattern to copy rather than invent.

Two constraints shape the rest. Error codes are a **documented agent contract** (`types/errors.ts`): recipes reference them by name, so adding codes is safe and renaming is breaking. And `route` already reads capability state from `taskless info --json`, which returns `{success, version, tools, loggedIn, auth}` through a validated schema, so the remote fields have an existing home and need no new command.

## Goals / Non-Goals

**Goals:**

- A project with no GitHub remote completes every local authoring path with no GitHub precondition, and has tests proving it.
- The remote tier's unavailability is reported as a capability boundary that names which of the three populations the caller is in, and is distinguishable from an auth failure without parsing prose.
- `route` does not offer a path that cannot complete; the remote recipe independently refuses when it is reached anyway.
- Telemetry can answer which GitHub owners use the product, including anonymously.

**Non-Goals:**

- Making `rule create` or `rule improve` work without a GitHub remote. They are remote generation; a verifiable org is the point, not an accident.
- Supporting non-GitHub hosts for remote generation. GitLab and Gitea remain unsupported; this change only makes the refusal legible.
- Changing `check`, `verify`, or `test`. They already behave correctly.
- Renaming or removing `NO_GITHUB_REMOTE`.
- Resolving whether a GitHub owner is an organization or a user account.

## Decisions

**Add codes rather than replace `NO_GITHUB_REMOTE`.** The three populations get their own codes; the existing code stays valid for consumers that already branch on it. Renaming would break the agent contract for no benefit, and a recipe pinned to the old code keeps working.

Alternative considered: one code plus a `population` field on the error. Rejected because recipes branch on `code` and would need new parsing to reach a nested field, where they already have a `## Errors` table keyed by code.

**Distinguish "not a git repository" from "no `origin`" with an explicit probe.** Both fail the same `git remote get-url origin` call, so the current code cannot tell them apart. A `git rev-parse --git-dir` (or equivalent) runs only on the failure path, so the ordinary case pays nothing.

Alternative considered: parsing git's stderr text. Rejected — it is localized and version-dependent, and this repository's own convention is to ask a tool for structured truth rather than re-derive it from output.

**`gh_owner`, not `gh_org`.** The first path segment of a GitHub URL is an organization _or_ a user account, and telling them apart requires an authenticated API call that anonymous runs cannot make. `gh_owner` is the value actually in hand. Naming it `gh_org` would assert something unverified and would be wrong for every personal repository.

Alternative considered: resolving the owner type when authenticated and recording `gh_owner_type`. Deferred — it splits the property's meaning across auth states, and the question this needs to answer ("which owners use the product") does not require it.

**Telemetry reads the owner from the remote, not from the token.** The purpose is visibility into _anonymous_ usage, so the value must resolve without a token. It comes from the same git remote resolution as everything else here. When no owner can be extracted it records the literal `[unknown]` rather than being omitted, so those runs remain countable in aggregate instead of vanishing; GitHub owner names cannot contain brackets, so the sentinel cannot collide with a real value.

**`info` exposes the repository URL so `route` has one source.** Without it, `route` would re-derive the remote itself and the two could disagree — the check that decides whether to offer remote generation would then differ from the check that enforces it. One resolution path, surfaced once.

`info` rather than `auth`, and rather than anything new: `route` step 2 already runs `taskless info --json` to read `loggedIn`, at exactly the moment it needs to know which destinations exist. The fields ride along on a call that is already made, already JSON, and already schema-validated. A dedicated command for org information would be new surface answering a question an existing call is already positioned to answer.

Alternative considered: a structured payload on `taskless auth`. Rejected — `auth` status is plain text today, so it would mean inventing an output format, and `route` does not call it.

**Two guards, deliberately.** `route` omitting the option is the good path; the recipe's own guard is what holds when an agent reaches the recipe directly, from a cached plan, or from a stale copy. Neither alone is sufficient: the first is advisory, the second is late.

## Risks / Trade-offs

- **Adding codes grows the union that recipes must document.** → New codes are added to the `## Errors` tables of the recipes that can raise them, in the same change; a code no recipe mentions is a code an agent cannot act on.
- **The extra git probe runs on an already-failing path.** → Acceptable: it is one process spawn, only when the remote could not be resolved, and it buys the distinction the whole change exists to make.
- **`gh_owner` records a value that may be a personal account handle.** → It is the literal owner segment of a remote the user configured, recorded under a name that does not claim to be an organization. Owner type is not inferred, and no attempt is made to resolve identity beyond what the remote states.
- **A sentinel value is a value, and will appear in every aggregate.** → That is the intent: `[unknown]` makes unparseable-remote runs countable rather than invisible. It is chosen so it cannot be confused with a real owner, since GitHub names admit only alphanumerics and hyphens.
- **Adding fields to `info` widens a payload agents already parse.** → Additive only, validated by the existing output schema, and `null` / `[unknown]` rather than absent so consumers need no presence check.
- **`route` becoming context-dependent could confuse a cached recipe.** → The recipe guard is the mitigation: an agent acting on stale routing still meets the constraint at the point of use.

## Migration Plan

No data migration and no scaffold version change. Each slice is independently safe in production and the stack merges forward:

1. **Error boundary** — new codes, the three-population distinction, reframed messages, tests. Safe alone: adds codes, changes only prose on paths that already fail.
2. **`info` fields** — `repositoryUrl` and `ghOwner` on the existing payload. Safe alone: additive to a schema-validated object.
3. **`gh_owner`** — telemetry property. Safe alone: absent when unresolvable.
4. **Recipe guards** — `route` and the remote recipe. Depends on slice 2 for the payload it reads.

Rollback is per-slice; nothing here is stateful.

## Open Questions

- Should `route` distinguish "no GitHub owner" from "not logged in" when explaining why remote generation is absent? Both foreclose the tier, but only one is fixable by `auth login`.
- Do any third-party consumers branch on the exact `NO_GITHUB_REMOTE` message text rather than the code? Retaining the code covers the contract; the prose changes regardless.
