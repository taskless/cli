## Context

`taskless check` runs its whole scan inside `checkCommand.run`: path classification, the schema refusal, `--rule` selection, the run directory, `planCheck`, engine config assembly, `runEngines`, and output. None of it is callable from another command. `taskless report` already runs every rule's tests through `verifyOneRule` while building its draft, but has never run the scan.

The live ReportV1 schema (fetched 2026-10-14) is the authority for the payload shape: `findings`, per-rule `state`, `violations`, `files`, and `surfaced`; no `fixed`, `fixedBasis`, `origin`, or `projection.perMonth`. Its rule: `findings` is present exactly when every written rule carries `violations` and `files`. Its service-side consistency checks require `findings.violations` to equal the rules' sum and `findings.files` to fall between the largest rule's `files` and their sum.

## Goals / Non-Goals

**Goals:**

- `report` and `check` run the same scan code, so a report's counts are the counts `check --anonymous` would print.
- Counts are deterministic: the CLI either has a defensible number for every written rule or publishes none.

**Non-Goals:**

- Running a legacy rule's own tool. The CLI cannot run eslint or ruff, and taking the agent's word for those counts is what this change exists to stop.
- Running runtime rules for a report. Reports are published logged out.
- Recomputing tskl.es's monthly rates in the terminal summary.

## Decisions

### Extract the scan, keep `check`'s surface

Move the part of `check` between "rules exist" and "results in hand" (open the run directory, `planCheck`, `assembleEngineConfigs`, `runEngines`, close the run) into a function under `packages/cli/src/rules/` that returns the plan and the dispatch. `check` keeps its argument handling, notices, output, exit code, and telemetry, and calls the function. `report` calls it with `anonymous: true`, no paths, and no selection.

`check` prints the plan's notices before dispatch; after the extraction they are printed when the function returns. Only stderr ordering moves, and only in text mode; `--json` output is unchanged.

_Alternative:_ spawn the built CLI's `check --json` from `report`. Rejected: it needs the built binary at a known path, doubles startup, and a test of `report` would depend on a build.

_Alternative:_ have `report` assemble its own sg and Vale invocation. Rejected: two scans that can drift apart are exactly how a report's number stops matching `check`'s.

### Anonymous is what keeps the draft offline

`planCheck` with `anonymous: true` skips reconcile entirely, so the scan makes no network call and every runtime rule is skipped. This is what lets the draft keep its "no network" requirement.

### All-or-nothing, decided in one place

A single function takes the written rules and the scan outcome and returns either `{ perRule, findings }` or nothing. It returns nothing when any of these holds:

- a written rule is `legacy`, or is a runtime rule under `.taskless/rules/runtime/`;
- the plan or the dispatch reports a failure;
- a result's `ruleId` names no rule under `.taskless/rules/sg/` or `.taskless/rules/vale/`.

The last guard matters because ast-grep reports a result under the `id:` in the rule body, and `sg-id-matches-directory` is a constraint `check` reports rather than a guarantee. Without the guard, a mismatched rule would publish a confident 0 while its real hits sat under a name nothing in the report has. Vale results already carry the bare directory id.

The draft computes this from the local rules alone. `--from` re-applies it after merging the facts, since a `legacy` entry in the facts is what removes the counts.

### File identity is the path relative to the repository root

Each result's `file` is resolved against `cwd` and made relative again before it is counted, so `./src/a.ts` and `src/a.ts` are one file. The service's lower bound (`findings.files` is at least the largest rule's `files`) then holds by construction.

### State comes from where a rule came from

`state` is set by the assembler, never by the facts: rules under `.taskless/rules/` and facts-file `legacy` entries are `written`, facts-file `cloud` entries are `candidate`. A local runtime rule is `written`, and it is the rule that triggers the runtime guard above.

### The summary reports raw totals, not rates

The summary prints `findings` when present, then Σ `surfaced.reviewComments` across Σ `surfaced.prs` over the window. It does not reproduce the service's ×30 ÷ days formula: two copies of a formula in two repositories is a number that drifts silently.

### The counting method counts every author

A comment asking for a rule's pattern costs something whoever wrote it: a bot review spends tokens and money, an author's own fix-up note spends their time and an agent's cycles, and a reviewer's spends review time. All three are what the rule saves, so bots and the pull request's author count the same as a reviewer. Excluding them was considered and rejected: it would undercount exactly the agent-heavy repositories a report is most often published for. The agent classifies each comment by reading it, because the bug report's run showed keyword matching is what an agent improvises when given no method.

## Risks / Trade-offs

- [The draft gets slower: it now scans the whole project as well as running tests.] → The draft runs once per report, and the scan is the same one CI already pays for.
- [A repository with one legacy rule never shows a findings headline.] → Accepted. tskl.es has a headline for that case, and a partly measured total would be a number the reader cannot interpret.
- [Moving plan notices after dispatch changes `check`'s stderr order.] → Text mode only, and nothing parses it. `--json` is unaffected, and its tests guard it.
- [A rule whose tests fail still runs in the scan and is counted.] → Correct: its matches are real matches. The gate already decides whether a failing rule counts toward the three.
