## Why

`check --json` has no per-rule summary, so measuring a repository means reading every finding: one agent run reported 300KB+ of output, and a harness that forbids piping to `jq` had to count by reading its saved output file. Its findings were also declared separately from the ones `verify --json` prints under `rules[].findings`, so a script written for one broke on the other (#678).

## What Changes

- `check --json` carries a `summary` on every run: totals, distinct files, counts by severity, and one entry per rule that fired, keyed by `engine` and `ruleId` (the pair `verify` groups `rules[]` by), most findings first.
- New `--summary` flag. With `--json` it omits `results` and keeps `summary`, so the output stays small on any repository. Without `--json` it prints per-rule counts instead of findings. The exit code is unchanged either way.
- One finding schema, `findingSchema`, declared once and used by both `check --json`'s `results[]` and `verify --json`'s `rules[].findings[]` (which extends it with `bucket`). The two had drifted: `check` allowed a `null` `note` and `fix`, `verify` did not. The shared schema takes `check`'s spelling.
- `@taskless/cli/schemas` publishes `findingSchema` and `checkOutputSchema`.
- The envelopes stay different, on purpose: `check` scans a codebase and its natural unit is a finding, while `verify` tests rules and its natural unit is a rule. `summary.rules[]` gives `check` the same per-rule grouping without moving `results`, which every existing consumer reads.
- The `check` recipe documents `summary` and `--summary` (topic v10).
- The stale JSONL description of `check --json` in the `cli-check` spec is corrected to the envelope the command has printed for a long time.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-check`: `--json` output carries a per-rule summary, `--summary` returns only that, and findings share one schema with `verify`.

## Impact

- `packages/cli/src/schemas/finding.ts` (new), `src/schemas/check.ts`, `src/schemas/rule-check.ts`, `src/schemas/index.ts`, `src/rules/summarize-findings.ts` (new), `src/commands/check.ts`, `src/util/format.ts`, `src/agent/check.md`, `packages/cli/README.md`.
- Additive for existing `--json` consumers: `results` is unchanged unless `--summary` is passed, and `summary` is a new key.
- Delivery shape: **single PR**. The schema, the flag, the recipe and the spec only make sense together, and the diff fits one review.
