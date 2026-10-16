## Why

#520's report priced every rule at $0 next to 114 findings in the code today, because value was estimated from review comments alone, using inputs the agent guessed. tskl.es has since taken over all value estimation: ReportV1 no longer has `projection` or `complexity`, and gains `estimatedViolations` on Cloud candidates. The schema is live, and its objects are closed, so a CLI that still sends `projection` is refused. Every current nightly does.

## What Changes

- **Vendored ReportV1 regenerated** from `https://tskl.es/api/v1/schema`.
- **No value inputs leave the CLI.** The payload loses `projection` and every rule loses `complexity`. The draft loses its default inputs, and `missing` no longer lists `estimates`.
- **The facts file stops asking for value.** `estimates` (`contextTokens`, `callsPerCatch`) and a candidate's `complexity` are removed, so supplying either is refused as an unknown field.
- **Cloud candidates carry an estimate.** Each `cloud` entry in the facts requires `estimatedViolations`: the agent's estimate of how many instances of the pattern are in the code today. The CLI carries it onto the candidate. Written rules never carry it, since they carry the measured `violations`.
- **Recipes.** The report recipe asks for the candidate estimate and no pricing input, and labels the estimate as the agent's when restating numbers. It drops the all-zero explanation added earlier in this PR, which the server's pricing makes wrong. The onboard recipe has the agent note what it saw of each candidate's pattern while mining.

## Capabilities

### Modified Capabilities

- `cli-report`: the draft, the facts, the gate, the recipe, and the measurement requirements drop value inputs and add the candidate estimate. "The payload carries projection inputs and no rates" is replaced by "The payload carries no value inputs".
- `cli-onboard`: the recipe has the agent note each candidate's instances for the report.

## Delivery Shape

**Single PR**, landing on #521 with the change it supersedes, so `main` never carries the all-zero explanation. `report` is in no release (0.12.0 predates it), so only nightlies have the old payload, and there is nothing for a consumer to migrate. The bump is `patch`.

## Impact

- **Code**: `packages/cli/src/report/{types,draft,assemble}.ts`, `packages/cli/src/schemas/report-facts.ts`, `packages/cli/src/generated/report-v1.schema.json`.
- **Recipes**: `packages/cli/src/agent/report.md`, `packages/cli/src/agent/onboard.md`; both topic versions already move in this PR (report v3, onboard v8).
- **Tests**: `packages/cli/test/report.test.ts`, `report-telemetry.test.ts`, `onboard.test.ts`.
