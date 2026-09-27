## Why

A runtime rule that stops running must never produce a green `check`. That is
the whole reason runtime rules are gated on a server signature, and #403 is the
one path where the CLI breaks it.

The paid-cloud launch (taskless/taskless#207, `signature-entitlement`) stops
blessing runtime rules for an organization whose plan lacks runtime signatures,
for example after a paid plan lapses. The server keeps reconcile at **HTTP 200**
and adds an additive `entitlement` object, so older CLIs keep working:

```ts
entitlement: {
  runtimeSignatures: boolean;
  reason?: "RUNTIME_SIGNATURES_NOT_IN_PLAN";
  upgradeUrl?: string; // absolute, carries from=reconcile
  withheld?: { ruleId: string; file: string }[];
}
```

A withheld file appears in `withheld` and in none of `run`, `unsafe`,
`unknown`, or `missing`. Restore and request retrieval carry the same object,
without `withheld`, whenever they return a runtime file set.

Every CLI through 0.11.2 reads only the four arrays. A withheld rule is absent
from `run`, so it is skipped with the generic reason "not blessed by the server
(unsafe / unknown / drift)", printed as a notice, and `check` exits 0. A
customer whose plan lapses gets a green `taskless check` while their runtime
rules have silently stopped running, and the one line that mentions it blames
tampering that did not happen.

The restore path has the mirror-image defect. Its completion notice promises
that "the next `check` reports the repaired signature and is blessed through the
ordinary path", which is false for an organization whose plan will not bless it.

## What Changes

- **`check` exits non-zero when `entitlement.withheld` is non-empty**, in human
  and `--json` modes. Withheld is a verified outcome (reconcile completed and
  answered), so it is not one of the degrade paths that deliberately never fail.
- **`check` names the cause.** A withheld rule's skip reason says the plan does
  not include runtime rules, not "unsafe / unknown / drift". The human output
  prints `reason` and `upgradeUrl` once; `--json` carries an additive
  `entitlement` object with `runtimeSignatures`, `reason`, `upgradeUrl`, and the
  withheld rule names.
- **The restore-completion notice stops promising blessing** when the restore
  response carries `entitlement.runtimeSignatures: false`, and says instead that
  the bytes were restored but will not run on this plan.
- **`rule create` and `rule improve` warn when they write a runtime rule** from
  a response carrying `entitlement.runtimeSignatures: false`: the rule is on
  disk but will not run on this plan. The warning rides the existing `notices`
  channel so `--json` callers see it too.
- **The reconcile client parses `entitlement` defensively.** Absent, malformed,
  or `runtimeSignatures: true` all mean "no entitlement outcome", so a server
  that predates #207 changes nothing.

Nothing changes for unauthenticated or `--anonymous` runs, for
`--dangerously-run-scripts`, for the degrade paths (reconcile unreachable,
401, no remote), or for `sg` and `vale` rules.

## Capabilities

### Modified Capabilities

- `cli-check`: the exit-code requirement gains the withheld case; a new
  requirement defines how a withheld rule is reported.
- `cli-rule-reconciliation`: a new requirement defines how the CLI reads the
  `entitlement` object and treats `withheld` as a disposition distinct from the
  four buckets.
- `cli-generated-rule-delivery`: a new requirement makes a runtime rule written
  under a plan without runtime signatures say so, at write time and on restore.

## Impact

- `packages/cli/src/api/reconcile.ts`: parse `entitlement`.
- `packages/cli/src/rules/runtime/plan.ts`, `run-set.ts`: classify withheld
  rules, carry the entitlement onto the plan, fix the restore notice.
- `packages/cli/src/commands/check.ts`, `schemas/check.ts`: exit code, human
  output, `--json` field.
- `packages/cli/src/commands/rules.ts`: write-time warning for create/improve.
- `packages/cli/src/api/restore.ts`: surface `entitlement` from the restore body.
- `packages/cli/src/agent/check.md`, `agent/ci.md`: document the new exit
  condition, which a CI recipe must not read as a findings failure.
- `api.schema.json` / `api.d.ts`: **not** regenerated here. #207 is not
  deployed; the live `__schema` carries no `entitlement` today (measured
  2026-09-27). Restore and retrieval type it as a field that might be present
  (`MayCarryEntitlement<T>`); tightening once it always is, is #409.

## Delivery shape

**Single PR.** The change is one behavior (a withheld rule fails the run and
says why) expressed at four call sites, plus the spec delta and tests, well
inside the ~1200-line guidance. It is independently safe to ship before the
server: with no `entitlement` in the response, every new branch is dead and
behavior is byte-identical to today, which is also the property that lets it
ship ahead of taskless/taskless#210 as the issue asks.

Fixes #403
