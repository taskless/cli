## Why

Onboarding mines five kinds of source for rule candidates, but the report credits only review comments: the recipe says commit evidence "never counts toward these numbers". A repository that pushes to `main`, or has little PR history, publishes every rule as raised in zero reviews even when the evidence was strong. About five runs in the CLI agent survey (Oct 12 to Nov 6) reported it. tskl.es now accepts the missing evidence (taskless/taskless#527, which closed taskless/taskless#516, deployed 2026-11-17), so the CLI can start sending it.

## What Changes

- Regenerate the vendored ReportV1 schema. It gains per-rule `sources`, seven kinds (`agent-files`, `conventions`, `docs`, `tests`, `reviews`, `commits`, `issues`), and `evidence`, a count of explicit call-outs for every kind but `reviews` (whose count stays `surfaced.reviewComments`). Both are optional, and `schemaVersion` stays `"1"`.
- The facts file accepts `sources` and `evidence` on every rule (`rules`, `legacy`, `cloud`), and the CLI passes them through to the payload unchanged. Their kinds are read from the vendored schema, so a schema refresh that adds a kind needs no edit to the facts.
- The CLI refuses, by field name and before any network call, the facts tskl.es would refuse on these fields: `sources` on some rules but not all, a kind listed twice, `reviews` without a review comment in `surfaced`, `commits`/`issues`/`docs`/`tests` listed without an `evidence` count, and an `evidence` count for a kind `sources` does not list.
- The publish summary gives each rule its two totals, the way the page does: "N times in reviews" (review comments, commits, issues) and "N times in conventions" (agent files, code comments, docs, tests), larger first, each only when above zero.
- The `onboard` recipe tallies evidence per candidate and per source while mining, replacing "commit history never counts" with a count of the commits that made the fix. The `report` recipe defines what a call-out is for each kind and asks for `sources` and `evidence` on every rule. Kinds are recorded, never paths.
- Facts without `sources` or `evidence` assemble and publish exactly as they do today.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-report`: the facts carry `sources` and `evidence`, which the CLI checks and passes through; the summary shows each rule's two evidence totals; the report recipe defines how to count each kind.
- `cli-onboard`: the scan step tallies evidence for every source while mining, and commit history is counted as `commits` evidence instead of not at all.

## Impact

- `packages/cli/src/generated/report-v1.schema.json` (regenerated), `src/schemas/report-facts.ts`, `src/report/types.ts`, `src/report/assemble.ts`, `src/report/summary.ts`, a new `src/report/evidence.ts` for the kind groups and checks, `src/agent/onboard.md`, `src/agent/report.md`, and their tests.
- No change to the wire contract beyond what tskl.es already accepts. A CLI without this change keeps publishing valid reports.
- Delivery shape: **single PR**. One contract the service already ships, its checks, one summary line per rule, and the two recipes that ask for it, with tests; well under the review budget.
- Changeset: `patch` (pre-1.0, additive).
