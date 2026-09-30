## Why

Renaming a rule's directory gets around tamper detection for ast-grep and Vale
rules (taskless/taskless#255). Copy `.taskless/rules/vale/foo-1/` to `bar-2/`,
loosen its `.vale.ini`, and delete `foo-1/`. v2 reconcile answers `bar-2` as
`unknown`, which the CLI runs silently as a locally written rule, and `foo-1` as
`missing`, which only warns. `check` passes with a tampered Taskless rule
running.

The product decision on #255 keeps deletion legitimate (`missing` stays a
warning, there is no retirement) and closes the hole on the copy. The service
change (taskless/taskless#262, published in `__schema` by taskless/taskless#264)
annotates such an `unknown` rule with `copyOf: { ruleId, revisionId, files }`
when any file it reported has the content of a signed file issued in this
repository, at any path. Its `cli` spec delta states the client obligation this
change implements. 0.12.0 is the first v2 client and is unreleased, so it ships
with the obligation from the start.

## What Changes

- An sg or Vale `unknown` rule carrying `copyOf` does not run: it is removed
  from the snapshot, and `check` fails naming the source rule and each file that
  differs from it.
- When the source is also answered `missing`, the copy and the deletion are
  reported as one rename, whose message names `taskless rule restore <source>`.
  The source gets no separate `missing` warning.
- A runtime `unknown` rule with `copyOf` is not executed, exactly as before; its
  skip reason now names the source. A runtime rename is one notice in place of
  the `missing` warning, and does not fail the run.
- A `copyOf` that is present but unreadable fails closed: the rule is
  unaccounted, does not run, and fails the run.
- `check --json`'s `integrity` gains an optional `copyOf` on `unknown` entries
  (`{ ruleId, revisionId?, sourceMissing }`), with the diff in the existing
  `files`. `engine.log` records each copy and whether it is a rename.
- The `check` and `recover-rule` agent recipes describe the failure and the fix
  (restore the source, delete the copy).
- Unchanged: `missing` without a copy, `unknown` without `copyOf`, every `run`,
  `unsafe`, and withheld outcome, accounting, and the request.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `cli-rule-reconciliation`: the per-engine verdict policy gains the `copyOf`
  row and the rename rule; `missing` stays a warning.
- `cli-check`: the exit code fails on a static copy, and `integrity` carries
  `copyOf`.

## Impact

- `packages/cli/src/rules/verdicts.ts` (policy), `plan-check.ts` (log line),
  `src/schemas/check.ts` (`--json` shape).
- Tests: `test/verdicts.test.ts` rows, one end-to-end case in
  `test/runtime-check.test.ts`.
- Recipes: `src/agent/check.md`, `src/agent/recover-rule.md`. Both are already
  new or bumped in this unreleased cycle, so their topic versions stay.
- The vendored v2 schema (`src/generated/api-v2.*`) is NOT changed: `copyOf` is
  read defensively from the untyped response, and the vendored files are
  re-generated once #264 is live.
- Changeset: one sentence added to the pending `.changeset/cli-v2-rule-api.md`.

## Delivery shape

**Single PR.** The change is one branch in a pure policy function plus its
reporting, tests, recipes, and spec, well under the review budget. It is safe on
its own: without `copyOf` in a response nothing changes, so it can land before
or after the service deploys #264.
