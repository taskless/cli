## Context

Two paths already call `GET /cli/api/v2/whoami` to pick the acting organization, both through
`resolveOrgSubject` in `packages/cli/src/auth/org.ts`: `resolveIdentity` (every `rule`
subcommand that talks to the service) and `planCheck` (`check`'s reconcile). Each discards
everything but the organization's `id`.

Every recovery suggestion in `check` is rendered in `applyVerdicts`
(`packages/cli/src/rules/verdicts.ts`) through one callback, `restoreCommand(ruleId)`, that
`planCheck` supplies so the policy stays free of how the CLI was invoked. It is used at three
sites: `unsafe` (runtime notice, static failure), `missing` (notice), and a rename
(`applyCopy`, when the source is `missing`). `rule revisions`' closing line is rendered by
`describeRevisions` in `rules/recover.ts`.

## Goals / Non-Goals

**Goals:**

- One place decides "restore or git", fed by the whoami call already being made.
- Unknown is byte-for-byte today's output, so every existing test keeps passing unchanged.

**Non-Goals:**

- Gating `rule restore` / `rule rollback` locally. See proposal.md.
- Reading `runtimeSignatures` from whoami. Reconcile already reports it authoritatively, per
  run, and `check` uses that.
- Surfacing entitlements in `info` or `auth status`. Nothing in this change needs it.

## Decisions

**Resolve the organization once, return its entitlement with its subject.** Replace
`resolveOrgSubject(cwd, token): Promise<string | number>` with
`resolveActingOrg(cwd, token): Promise<{ subject: string | number; restoreRules?: boolean }>`.
`restoreRules` is set only when an organization matched and its `entitlements.restoreRules`
is a boolean; the token-claim and nil-UUID fallbacks leave it `undefined`. `Identity` gains
`restoreRules?: boolean`. Considered: a second `fetchWhoami` from the suggestion sites.
Rejected because the issue requires no extra request, and a second call could disagree with
the first about which organization acted.

**The generated whoami type is read defensively.** `entitlements` is optional in the schema
and "absent means unknown". Read it with `typeof === "boolean"`, so an older or partial
response degrades to unknown rather than throwing.

**Replace `restoreCommand` with a `recovery` callback that returns a whole sentence.** Today
each site writes `Run \`${restoreCommand(id)}\` to <purpose>.`The git alternative is two
commands and a reason, which does not fit a slot shaped like one command. The callback
takes`{ ruleId, engine?, purpose }`and returns the sentence.`planCheck` builds it from the
tri-state:

- not `false`: `Run \`<prefix> rule restore <ruleId>\` to <purpose>.`, exactly today's text.
- `false`: `Restoring rules is not included in your organization's plan, so recover it from
git: \`git log -- <dir>\` lists the commits that changed it, and
  \`git restore --source=<commit> -- <dir>\` puts it back as of one of them.`

`<dir>` is `.taskless/rules/<engine>/<ruleId>/`, or the quoted glob pathspec
`'.taskless/rules/*/<ruleId>/'` when a `missing` verdict carries no known engine. The
rendering lives in a small pure function beside `applyVerdicts` so it is tested as a table
like the rest of the policy. Considered: passing the tri-state into `applyVerdicts`. Rejected
to keep `verdicts.ts` free of CLI prefix and plan concerns, which is why the callback exists.

For a `missing` rule the newest commit `git log` lists is the one that deleted it. The
sentence says "as of one of them", and the `check` recipe spells out choosing the commit
before the deletion. A notice line is not the place for a git tutorial.

**`describeRevisions(list, restoreRules?)`.** When `false`, the closing line becomes
`Rolling back is not included in your organization's plan; earlier versions of this rule are
in the repository's git history.` Otherwise unchanged. The command passes
`identity.restoreRules`.

**Recipes.** `check.md` (v4 → v5): an edited or missing rule is reported with either
`rule restore` or git steps; follow whichever `check` printed, and for a deleted rule restore
from the commit before the deletion. `recover-rule.md` (v2 → v3): before offering restore or
rollback, read what `check` or `rule revisions` offered. If it gave git steps, the plan
excludes recovery; follow them rather than running a command that will be refused.

## Risks / Trade-offs

- [Entitlement changes between whoami and the suggestion, e.g. an upgrade mid-session] →
  Each run reads whoami fresh, and the recovery commands still call the service, so the worst
  case is one run with a stale suggestion.
- [A `false` from whoami that the service would not refuse] → The user is sent to git, which
  still works. Nothing is blocked, so a wrong hint costs a detour, never a capability.
- [Glob pathspec on an unknown engine] → Quoted so the shell does not expand it; git applies
  glob pathspecs by default. Only reachable when reconcile omits the engine, which it rarely
  does.

## Migration Plan

None. No config, schema, or `--json` change. Rolling back the release restores the old
suggestions.
