## Why

A published report lists each rule by its title and numbers, which says what a rule enforces but not why this repository should care. ReportV1 on tskl.es now carries an optional per-rule `explain`: plain prose on how the rule improves the codebase, scrubbed by the CLI like `title`. The agent that wrote or proposed each rule is the one that knows why, so the CLI should ask it every time.

## What Changes

- **Vendored ReportV1 regenerated** from `https://tskl.es/api/v1/schema`. It adds `explain` on rules (1 to 1000 characters, at least one non-space) and a non-space `pattern` on `title`.
- **Every rule in the facts requires `explain`.** Local `rules`, `legacy`, and `cloud` entries each take one; a missing, blank, or over-length one is refused under `REPORT_INVALID`. ReportV1 keeps it optional; the CLI is stricter so no report it publishes has a rule without one. `title` also refuses a blank value now, matching the schema.
- **The CLI carries `explain` onto every published rule** and screens it with the other agent-supplied strings, so a match refuses the publish under `REPORT_REDACTION` naming the field.
- **Recipe.** The report recipe (topic v6) asks for an `explain` on every rule and gains `## Explaining a rule`: one or two sentences, what goes wrong without the rule and what holding it buys, grounded in the session, no counts, no names or hosts.

## Capabilities

### Modified Capabilities

- `cli-report`: the facts carry a required `explain` per rule, the redaction screen covers it, and the recipe asks for it.

## Delivery Shape

**Single PR.** The change is one reviewable diff. `report` is in no release (0.12.0 predates it), so the bump is `patch`, and the release note extends the existing report changeset rather than adding one.

## Impact

- **Code**: `packages/cli/src/schemas/report-facts.ts`, `packages/cli/src/report/{types,assemble}.ts`, `packages/cli/src/generated/report-v1.schema.json`.
- **Recipe**: `packages/cli/src/agent/report.md`.
- **Tests**: `packages/cli/test/report.test.ts`, `report-telemetry.test.ts`.
