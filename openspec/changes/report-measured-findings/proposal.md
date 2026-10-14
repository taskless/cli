## Why

A published report never says what its rules find in the code today, even though `taskless check` measures exactly that. Every number on the page came from the facts file, so the one figure that does not depend on trusting the agent was missing, and `fixedBasis: measured` could be claimed with no method behind it. tskl.es has since reshaped ReportV1 around measured findings (live at `https://tskl.es/api/v1/schema` on 2026-10-14), and the nightly's payload no longer validates against it: every publish is refused with a 400.

## What Changes

- **The CLI measures current violations itself.** `taskless report` runs the project's static rules the way `check --anonymous` does and records, per written rule, `violations` and `files`, plus a top-level `findings: { violations, files }` where `files` counts distinct files across all rules. The draft carries them, and `--from` re-measures at publish.
- **Counts are all-or-nothing.** They are published only when the CLI ran every written rule and could attribute every result to one. A legacy rule, a local runtime rule, an engine failure, or a result under an unknown rule id omits `findings` and every per-rule count, and tskl.es falls back to a headline built from what remains. The agent can never supply them.
- **Every rule carries `state`.** Rules under `.taskless/rules/` and legacy rules are `written`; facts-file `cloud` entries are `candidate` and carry no counts.
- **BREAKING (nightly only):** `fixed` and `fixedBasis` are removed from the facts file and the payload. `origin` is renamed `surfaced: { prs, reviewComments }`.
- **BREAKING (nightly only):** `projection.perMonth` is no longer sent. tskl.es derives both monthly rates from each rule's `surfaced` and the window, and refuses a payload that carries them. `projection.inputs` is unchanged.
- The vendored ReportV1 schema is refreshed.
- The publish summary leads with the measured findings when present, and reports review counts as raw totals over the window rather than as a projection.
- The `report` and `onboard` recipes stop asking for fix counts, give one method for counting `surfaced`, and require the agent's own recap to keep "found in the code today" apart from "raised in review over the window".

Delivery shape: **single PR.** The schema change, the measurement, and the recipe changes are only correct together: landing the schema alone would publish reports with no findings, and landing the recipes alone would describe fields the CLI cannot send.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-report`: the draft and the payload carry CLI-measured findings; the facts file loses fix counts and renames origin to surfaced; rules carry a state; the CLI stops computing monthly rates; the summary and the recipe change to match.

## Impact

- `packages/cli/src/commands/check.ts`: the scan it performs is extracted so `report` can run the same one.
- `packages/cli/src/report/` (`draft.ts`, `assemble.ts`, `types.ts`, `summary.ts`) and `packages/cli/src/schemas/report-facts.ts`.
- `packages/cli/src/generated/report-v1.schema.json`, refreshed by `scripts/fetch-report-schema.ts`.
- `packages/cli/src/agent/report.md` and `packages/cli/src/agent/onboard.md`.
- Tests under `packages/cli/test/` for report and check.
- No change to `taskless check`'s output or exit codes.
- Ships in a nightly; a `patch` changeset, since the package is pre-1.0 and the report fields being changed have not been released.
