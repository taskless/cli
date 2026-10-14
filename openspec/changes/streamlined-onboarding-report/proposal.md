## Why

Onboarding is a conversation today: the agent asks which sources to mine, asks again for every candidate it found, asks when the rules should run, and asks before marking anything complete. Every one of those turns is a place a fresh user stops, and the flow ends with rules on disk but nothing that shows what they are worth. We want onboarding to be one yes followed by a finished result, and that result to be something a user can look at and share: a report on tskl.es showing what Taskless found and what it will catch.

## What Changes

- **Onboarding asks one question.** The recipe opens with "Do you want me to set up Taskless for you?", set apart by blank lines and put through the host's structured question tool when it has one. That yes covers mining, writing rules, publishing the report, and sending onboarding feedback. The per-source menu, per-bullet materialization offer, and the separate mark-complete confirmation are removed from the flow. The CI decision moves to the very end, as a strongly encouraged offer to wire `taskless check` into CI, because checks in CI are what keep agents from reintroducing what the rules catch. **BREAKING** for the recipe's contract (topic v5 → v6); no CLI surface is removed.
- **Onboarding is always anonymous.** It authors only rules the CLI can write logged out (`legacy`, `sg`, `vale`). Candidates the agent judges are better solved by a runtime rule are not authored; they go into the report as `cloud` tier.
- **Clarifying questions only when stuck.** The agent asks the user anything further only when it is unsure what rules to write AND the report gate refuses for fewer than three Taskless rules (`sg`, `vale`, or `legacy` rules it wrote). Cloud-tier candidates are carried in addition and do not count.
- **Onboarding completes itself.** The agent runs `onboard --mark-complete` once the rules are written, without a confirmation question, and then runs the report recipe. In parallel it sends onboarding feedback through `rule-feedback`, answering as the respondent. `onboard` no longer carries the survey invite.
- **New `taskless report` command.** With no flags it prints a draft: everything the CLI can know about this repository's rules, plus `missing[]`, the facts only the agent can supply. `taskless report --from <file>` takes the agent's facts, computes the projection, enforces the gate, redacts, validates against the vendored ReportV1 schema, publishes to `https://tskl.es/api/v1/reports`, records the result under `.taskless/reports/`, and prints a brief templated rule summary with the link. `taskless report delete` removes a published report using the recorded delete credential.
- **New `report` agent topic**: check what exists, supply what is missing, generate, delete on request. Onboarding hands off to it, and it serves "regenerate my Taskless report" later.
- **ReportV1 is vendored** from `https://tskl.es/api/v1/schema` by a generate script, the same way the cloud API schema is.
- **Migration 11** creates `.taskless/reports/` and adds `/reports/` to `.taskless/.gitignore`, since each record holds a credential that deletes a page anyone with the link can view.
- **`detect` reports more.** ast-grep and Vale join the linter signals (configs under `.taskless/` are Taskless's own and are skipped). `detect --json` gains the host tools (`gh`, `git`, `jq`, and new `glab`) and an `agent` hints section naming commands the agent may choose to run, such as `gh auth status`. Detect still executes nothing and stays offline.
- **Rename** `packages/cli/src/rules/report.ts` to `rules/check-summary.ts`, which is what it is (the `check`→reconcile summary), so "report" means one thing in this codebase.
- **The skill** routes "make / regenerate a Taskless report" to the `report` topic.

## Capabilities

### New Capabilities

- `cli-report`: the `taskless report` command (draft, `--from` publish, `delete`), the facts file the agent supplies, projection and gate, redaction, schema vendoring and validation, the publish client and its retry policy, the `.taskless/reports/` record, the templated summary, and the `report` agent topic.

### Modified Capabilities

- `cli-onboard`: the recipe requirement is rewritten for the one-question, always-anonymous, self-completing flow and topic v6; the conversational menu, per-bullet offers, and consent-gated mark-complete are removed from it, and the CI offer moves to the end.
- `cli-detect`: "Detect scans deterministic repo signals only" is restated to cover ast-grep and Vale signals, the `.taskless/` exclusion, and host tools reported by presence; "Detect emits a stable JSON shape" gains the `hostTools` and `agent` fields.
- `cli-taskless-bootstrap`: the `install.onboarded` semantics now record the user's yes to onboarding rather than a separate confirmation (the field is still written only by `--mark-complete`); adds migration 11.
- `cli-feedback-survey`: `onboard` leaves the surveyed recipes; onboarding feedback is sent by the agent unprompted, still honoring the telemetry opt-out.
- `cli-agent`: registers the `report` topic.
- `skill-taskless`: the router's topic table gains a `report` row.

## Delivery Shape

**Stacked, merging forward.** Each unit is safe in production on its own: detect's new fields are additive, the rename changes no behavior, and `taskless report` is inert until a recipe calls it. Only the onboard rewrite depends on the units below it, and it is the last to land.

1. Detect: ast-grep/Vale signals, `glab`, host tools and `agent` hints in `--json`. The changeset lands here, grown by each later PR.
2. Rename `rules/report.ts` → `rules/check-summary.ts`.
3. `taskless report`, schema vendoring, migration 11, the `report` topic.
4. Onboard topic v6, skill row, feedback interplay, automatic mark-complete.
5. Archive this change.

Diffs 3 and 4 may pass ~1200 lines; that is accepted for this change, since the report command's parts (merge, gate, redaction, publish) are only reviewable together. The package is pre-1.0, so the bump is `patch`.

## Impact

- **Code**: `packages/cli/src/commands/` (new `report.ts`, `onboard.ts`), `packages/cli/src/agent/` (`onboard.md` v6, new `report.md`, `rule-feedback.md`), `packages/cli/src/detect/` (`scan.ts`, `host-tools.ts`, detect schema), `packages/cli/src/survey/constants.ts`, `packages/cli/src/filesystem/migrations/` (new 0011), `packages/cli/src/rules/report.ts` (renamed), `packages/cli/scripts/` (new schema fetch), `packages/cli/src/generated/` (vendored ReportV1), the skill and `tskl` command bodies, `packages/cli/src/prompts/` (topic classification).
- **Network**: a new outbound call to `tskl.es` (publish and delete), separate from the Taskless API and requiring no auth.
- **Privacy**: rule fixtures leave the machine on a page viewable by anyone with the link. tskl.es performs no redaction of its own; the agent and the CLI are solely responsible, and withhold rather than partially mask.
- **External dependency**: `report delete` sends an HTTP `DELETE` to the `deleteUrl` tskl.es returns on publish. The tskl.es side is adding that support; the schema's `x-taskless` block does not describe it yet.
