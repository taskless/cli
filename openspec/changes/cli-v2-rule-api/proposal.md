## Why

Three things are broken or missing in 0.11.2, and the server has shipped the
contract that fixes all three at once:

- **Restore has never worked.** The CLI posts a rule id to
  `POST /cli/api/request/<ruleId>/restore`, the server looks it up as a ticket
  id, and every repair answers `404` (TSKL-307). The v1 route will not be
  repaired.
- **Only a runtime rule's `check.ts` is protected.** sg and vale rules run with
  no reconcile at all, and a runtime rule's `captures/*.yml` are unsigned. This
  came from an agent editing a rule's `.vale.ini` so its own violation would
  pass; nothing today could notice.
- **What runs is not what was judged.** `materializeRuntimeRules` copies a rule
  into `.taskless/.run/` after reconcile blessed it, so an edit made in between
  runs unverified.

The v2 rule API (taskless/taskless#229, live at `/cli/api/v2/`) addresses rules
by their own stable id, signs every non-fixture file of every engine, judges a
rule as a whole, and gates restore and rollback on the organization's plan.
**The first CLI release that speaks v2 becomes the server's minimum supported
version**: after it ships, v1 refuses older clients (`400 upgrade_required`) and
answers `410 moved` to newer ones. That release is 0.12.0.

## What Changes

- **BREAKING (server-enforced): the CLI speaks only v2.** Every call moves under
  `/cli/api/v2/`; `/cli/auth/*` is unchanged. Every request carries
  `x-taskless-cli-version`. The vendored schema becomes v2's `__schema`, and v1
  client code is deleted.
- **`check` reports every rule of every engine,** one `{ ruleId, files }` per
  `.taskless/rules/<engine>/<ruleId>/`, covering every file except `.tests/**`.
- **Copy, then sign, then run the copy.** `check` snapshots the rules tree into
  `.taskless/.run/` first, signs and reports the snapshot, and every engine runs
  from it. A verdict describes the bytes that actually ran.
- **BREAKING: an edited sg or vale rule fails `check`.** The per-engine verdict
  policy applies: `unsafe` static rules fail the run (naming each differing
  path) and do not run; `unknown` static rules still run; `missing` warns;
  `withheld` runtime rules fail as they do today.
- **`check` accounts for every rule it reported.** A rule in none of `rules`,
  `unknown`, or `entitlement.withheld` fails the run. Two rule directories with
  the same id under different engines fail the run before anything is reported.
- **`check` never restores.** It reports and names the command to run. The
  current in-`check` repair is removed.
- **New `taskless rule restore <ruleId>` and `taskless rule rollback <ruleId>
<revisionId>`.** Every served file is checked against its signature and, for
  restore, against what reconcile said the rule should be; a mismatch is never
  written. On a plan without `restoreRules` the server's git-recovery message is
  printed as the answer.
- **`rule create` and `rule improve` use v2 generation.** Poll the request, fetch
  each produced rule's head by `ruleId`, confirm the `revisionId`, verify the
  signatures, and replace the rule directory.
- **BREAKING: `rule create --json` stops calling the request id `ruleId`.** It
  prints `requestId` plus the produced rule ids. `rule improve`'s input
  `ruleId` is now the rule's directory name, which is what v2 addresses.

Nothing changes for `verify`, `test`, `rule delete`, or local-only (anonymous)
authoring. Unauthenticated, `--anonymous`, and unreachable-service runs still
never fail on verification: static rules run unverified and runtime rules are
skipped, as today.

## Capabilities

### New Capabilities

- `cli-rule-recovery`: `rule restore` and `rule rollback`, their verification
  of served bytes, and how a plan refusal is presented.

### Modified Capabilities

- `cli-rule-reconciliation`: per-rule reporting across every engine, the v2
  verdicts, accounting for every reported rule, rule-id uniqueness, withheld by
  rule id, and the v2 hash-vector endpoint. The per-file contract and in-`check`
  re-fetch are removed.
- `cli-check`: static rules join reconciliation; the exit code gains edited
  static rules, unaccounted rules, and duplicate ids; `check` never writes the
  rules tree; `--json` reports rule integrity.
- `cli-runtime-rule-execution`: execution uses the snapshot taken before
  signing, not a copy made after blessing.
- `cli-generated-rule-delivery`: every delivery is a v2 file set whose
  signatures are verified before writing, and a delivered rule replaces its
  directory.
- `cli-rules`: create and improve use the v2 generation flow and publish
  `requestId`; the stale v1 server-endpoint requirements are removed.

## Impact

- `packages/cli/src/api/*`: new v2 client for request, rule fetch, iterate,
  reconcile, restore, rollback, whoami; `entitlement.ts` parses v2 shapes;
  `restore.ts` and the v1 `reconcile.ts` / `rules.ts` are replaced.
- `packages/cli/src/rules/runtime/{plan,run-set,repair}.ts`: generalize from
  runtime `check.ts` to every engine's rule directory; delete in-`check` repair.
- `packages/cli/src/rules/{assemble,dispatch,engines}.ts`: assemble and run sg
  and vale from the snapshot root.
- `packages/cli/src/commands/{check,rules}.ts`, `schemas/*`: verdict policy,
  new `--json` fields, new `restore` / `rollback` subcommands, create/improve
  output.
- `packages/cli/scripts/fetch-api-schema.ts`, `fetch-rule-hash-vectors.ts`,
  `src/generated/api.schema.json`, `api.d.ts`: vendor v2.
- Agent recipes: `check`, `ci`, `create-remote-rule`, `improve-rule`,
  `rule-meta`, `create-runtime-rule`, plus a recipe for recovering a rule.
- Cross-repo: the server sets `V2_CLI_FLOOR` from this release. After it ships,
  0.11.x remote generation and reconcile stop working (accepted in #229).

## Delivery shape

**Stacked, merging down.** The units are only correct together. A prerelease
resolves to the release it precedes, so any nightly stamped `0.12.0-*` is a v2
client in the server's eyes. If a partial slice reached `main`, the nightly
would publish a CLI that the gate treats as v2 while it still calls v1 routes,
which answer `410` once the floor is set. The stack therefore merges down to the
bottom branch and reaches `main` in one protected merge.

Slices, each targeting the one below it:

1. **Contract** (bottom, targets `main`): this change, the v2 schema vendoring,
   the v2 API client, and the `minor` changeset.
2. **Generation**: `rule create` / `rule improve` on v2, verified delivery.
3. **Reconcile**: snapshot, per-rule reporting, verdict policy, accounting,
   `check` output. The largest slice.
4. **Recovery**: `rule restore`, `rule rollback`, the refusal.
5. **Retire v1**: delete v1 code and tests, recipes, the end-to-end round trip
   against production, and the archive.

The changeset is `minor` and lives on slice 1. Two reasons, either sufficient:
`check` now fails on an edited sg or vale rule, and `rule create --json` renames
a field consumers read, both of which consumers must react to; and a `patch`
changeset would stamp nightlies
`0.11.3-*`, below the v2 floor.

Refs TSKL-307
