## Context

See proposal.md for motivation. The constraints that shape the approach:

- **Recipes are embedded at build time** and served by two paths for onboarding (`taskless onboard`, `taskless agent onboard`), which must agree byte for byte in every host-tool state. Recipes are also published through `@taskless/cli/prompts`, whose graph may reach no node builtin, so host state is passed in as a render option and never read ambiently.
- **Host detection looks, never runs.** `packages/cli/src/detect/host-tools.ts` establishes a tool by finding a file on `PATH`, and `cli-detect` requires detect to work offline and logged out. Both properties survive this change: sign-in checks become hints for the agent, not something detect does.
- **The ReportV1 contract belongs to tskl.es.** It is published as JSON Schema at `https://tskl.es/api/v1/schema` with an `x-taskless` block describing publish: `POST /api/v1/reports`, 256 KiB cap, 10/min/IP, retry only on 502 and never after a timeout. Every object rejects unknown keys. tskl.es does not redact.
- **The cloud API schema is already vendored** by `scripts/fetch-api-schema.ts` (committed document, no timestamp, fail loudly on a failed fetch). The report schema follows that precedent.
- **The name `report` is taken internally**: `packages/cli/src/rules/report.ts` is the summary `check` sends to reconcile.

## Goals / Non-Goals

**Goals:**

- One CLI-owned path from a repository to a published report, where every number the page shows is either measured by the CLI or explicitly an agent estimate.
- The CLI, not the recipe, enforces the gate, redaction, validation, and the retry contract, so a skimmed recipe cannot publish something bad.
- Regenerating a report later is the same recipe as the first one.

**Non-Goals:**

- `public` retention. Every report publishes `private` (unlisted, 30 days). Choosing public is a later decision with its own consent story.
- Authoring runtime rules during onboarding, or logging in.
- Detecting `.cmd`-wrapped tools on Windows (see Risks).
- GitLab scopes in the report. ReportV1 knows only `github` and `none`; a GitLab repository reports as `none`.
- A `linear` or `acli` host tool. Both names collide with unrelated tools (several `linear` CLIs; Acquia CLI installs as `acli`), and their MCPs are the more common route.

## Decisions

### D1. The agent hands over facts, and the CLI builds the report

`report --from` takes a facts file, not a ReportV1. The agent supplies only what it alone knows (history, window, per-rule titles, origin and fix counts, legacy and cloud entries, two estimates, its redaction counts and withholdings). The CLI owns everything else and wins any conflict.

_Alternative:_ the agent edits the draft into a full ReportV1. Rejected: it puts the projection arithmetic in a prompt, lets the agent overwrite facts the CLI measured, and makes the facts schema and ReportV1 the same thing, so a tskl.es schema change would break the recipe instead of one merge function.

### D2. The draft lists what is missing

`taskless report` prints the CLI's half plus `missing[]`. The recipe says "supply what `missing` names" rather than enumerating fields, so the facts schema and the recipe cannot drift.

### D3. Projection arithmetic

Per tier, over a facts-declared window of `d` days:

```
commentsPrevented[tier] = round(Σ rule.origin.reviewComments × 30 / d)
agentCatches[tier]      = round(Σ rule.fixed               × 30 / d)
```

`contextTokens` and `callsPerCatch` are agent estimates from this user's session habits (how large their sessions run, how many extra turns a missed issue costs). tskl.es exposes them as sliders, so the published page lets a reader adjust them, and turns them into its token figures itself. The other inputs (`cloudComplexity`, `pricePerMillionTokens`, `minutesPerComment`, `reviewerHourlyUsd`) are CLI constants, matching the schema's example values until there is a reason to differ.

The gate is `≥ 3` Taskless rules: `cli` tier, or `legacy` rules the agent wrote into the repository's own linter, with tests neither `fail` nor `refused`. Cloud candidates are carried in addition and never count. The projection does not gate: the page lets a reader adjust its inputs, so a threshold on it would gate on a number nobody sees. The gate lives in the CLI so it has one home.

### D4. Tiers and engines

| Source                                                                | tier     | engine                           | tests                                        |
| --------------------------------------------------------------------- | -------- | -------------------------------- | -------------------------------------------- |
| `.taskless/rules/sg/<id>`                                             | `cli`    | `sg`                             | from `.tests/`, CLI-run                      |
| `.taskless/rules/vale/<id>`                                           | `cli`    | `vale`                           | from `.tests/`, CLI-run                      |
| `.taskless/rules/runtime/<id>` (existing, not authored by onboarding) | `cloud`  | `runtime`                        | `not-run` (logged out)                       |
| facts `legacy[]` (rule written into the repo's own linter)            | `legacy` | omitted; `tool` names the linter | `not-run` unless the agent supplies fixtures |
| facts `cloud[]` (runtime candidate, not authored)                     | `cloud`  | `runtime`                        | `not-run`; `complexity` from the agent       |

Fixture code is the first failing and first passing case from the rule's tests, subject to D5.

### D5. Redaction: withhold, never mask

The CLI scans each fixture and every agent-supplied string for five pattern classes (`secret`, `email`, `host`, `ip`, `phone`). A fixture hit withholds the whole fixture, because a half-masked snippet reads as broken code on a page meant to show the rule working. A hit in an agent-supplied string (a title, a label) refuses with `REPORT_REDACTION`, because the CLI cannot rewrite prose and the agent can. `person`, `customer`, and `text` can only be judged by the agent, which declares its counts; the CLI adds its own per category. `policyVersion` is a CLI constant, bumped whenever the patterns change.

_Alternative:_ mask matches in place. Rejected for fixtures as above, and because a masked secret still leaks its shape and length.

### D6. Vendoring and validating ReportV1

A `scripts/fetch-report-schema.ts` writes `src/generated/report-v1.schema.json` in the style of `fetch-api-schema.ts` (no timestamp, prettier-formatted, fail loudly). It is not on the build path.

For validation, the decision is zod 4's `z.fromJSONSchema()` over the vendored document (zod 4.3.6 is already a dependency and exports it), giving one schema used for both validation and the inferred type. Task 3.1 confirms it handles this document (the `oneOf` scope, `const`, regex `pattern`s, `format`) with a test over the schema's own example and counter-examples. A gap there is a bug to fix or report against zod, not a reason to hand-write the schema. No new dependency.

### D7. Publish client

`fetch` with a timeout. A 502 is retried at most twice with short backoff. A timeout or network error is never retried and becomes `REPORT_PUBLISH_UNKNOWN`, because tskl.es says a timed-out publish may have succeeded. A 429 is surfaced, not retried: the limit is per IP and a loop would only extend it. The URL is a constant overridable by an environment variable for tests, mirroring how the API base URL is handled.

### D8. The record and the delete credential

`.taskless/reports/<UTC YYYY-MM-DD_HHMMSS>.json` holds `{ url, deleteUrl, expiresAt }` exactly as returned. The delete credential is the `deleteUrl` tskl.es returns once; the user's "delete key" is that value. It never reaches stdout or telemetry, and the directory is gitignored by migration 11. `report --delete` reads the record and sends an HTTP `DELETE` to `deleteUrl`, the URL tskl.es returns for exactly that.

### D9. Detect: one table for tools, presence, and hints

`host-tools.ts` gains a single table, one row per tool: name, applicability predicate, inapplicable reason, hint command, and hint text. `detect --json`, the `agent` hints, and the onboard recipe's host-tool passages all render from it. `glab`'s applicability comes from the same remote resolution as `gh`'s, extended to recognize a GitLab host. Its hint states that `glab auth status` can exit 0 when signed out (gitlab-org/cli#911), so the agent reads the output.

ast-grep (`sgconfig.yml`, `.sgconfig.yml`) and Vale (`.vale.ini`, `_vale.ini`) join the linter signals, with `.taskless/` pruned from their evidence.

### D10. Onboard v6 and the survey

Onboarding loses its survey invite (`onboard` leaves the surveyed set in `survey/constants.ts`) and instead tells the agent to follow `rule-feedback` unprompted. `rule-feedback` gains a short "reached from onboarding" branch: no `verbatim`, no question, send. `feedback send` already refuses under the telemetry opt-out, so nothing new is needed there.

The CI/hooks step moves to the very end. It is the one question after the opening yes, asked once the user has seen the report, and the recipe strongly encourages a yes: checks in CI are what keep agents from reintroducing what the rules catch. Doing it unasked would write CI config the user did not request. A no gets the `hooks` topic named in one line as the local alternative.

### D11. Rename before build

`rules/report.ts` → `rules/check-summary.ts` (with its importers: `plan-check.ts`, `recover.ts`, `verdicts.ts`, two tests) lands as its own PR, so the largest diff is not also carrying a rename.

## Risks / Trade-offs

- **[A report can publish with a small projection]** → Accepted. Three working Taskless rules justify a report on their own, and the reader can adjust the estimates on the page.
- **[Agent estimates drive the headline]** → `fixedBasis` distinguishes measured from estimated per rule, and the page's sliders let a reader correct the two estimates. The recipe instructs the agent to estimate from observed session behavior, not optimism.
- **[Pattern redaction misses things]** → tskl.es does not redact, so a miss is published. Mitigations: withhold-not-mask, the agent's own pass declared in the facts, `private` retention, a recorded delete credential, and the recipe telling the agent to withhold anything it cannot vouch for.
- **[A timeout may have published]** → `REPORT_PUBLISH_UNKNOWN` says so plainly. No record is written, so the possible report cannot be deleted from the CLI; it expires in 30 days.
- **[tskl.es schema drift]** → A vendored schema that falls behind makes the CLI refuse a payload tskl.es would accept, or send one it rejects. The refresh script makes the drift a reviewable diff, and a 400 surfaces tskl.es's own details.
- **[Windows `.cmd` tools]** → `executableName()` appends only `.exe` and `findOnPath` ignores `PATHEXT`. Every tool detected today ships an `.exe`, so nothing is missed now; a future `.cmd`-only tool (for example `az`) would be silently reported absent. Recorded, not fixed.
- **[A CI offer after a long flow is easy to skip]** → It comes last, after the report has shown the value, and the recipe tells the agent to make the case for it rather than just mention it.

## Migration Plan

Migration 11 runs on the next bootstrap of any existing `.taskless/`, creating `reports/` and its ignore line. Nothing else migrates. Rolling back the CLI leaves an unused, ignored `reports/` directory behind, which is harmless; older CLIs refuse a newer scaffold through the existing version check unless `--allow-version-mismatches` is passed.
