## Context

The service half shipped as `report-rule-evidence` in taskless/taskless (archived 2026-11-17). Its design fixes the contract this change follows and does not reopen:

| Kind          | Group       | A call-out is                                              |
| ------------- | ----------- | ---------------------------------------------------------- |
| `agent-files` | conventions | a line in AGENTS.md, CLAUDE.md or similar                  |
| `conventions` | conventions | a code comment (TODO, FIXME, XXX, HACK) asking for it      |
| `docs`        | conventions | a passage in the docs, `@deprecated` and the like included |
| `tests`       | conventions | a test that pins the behaviour                             |
| `reviews`     | reviews     | a review comment, counted as `surfaced.reviewComments`     |
| `commits`     | reviews     | a commit in `scope.window` that made the fix               |
| `issues`      | reviews     | an issue, ticket, recorded decision, or a comment on one   |

Counts are of explicit call-outs, never of code that follows a pattern. `evidence` does not require `history`, because commits are read with `git` alone. The issue (#681) says `trackers`; the service named the kind `issues`, and TODO/FIXME comments are `conventions`, not a kind of their own.

The CLI builds the payload from a facts file the agent writes (`schemas/report-facts.ts`), validates the payload against the vendored JSON Schema, and repeats a service check itself where the agent needs the field named (`checkWindow`). The JSON Schema cannot express the cross-field rules on `sources` and `evidence`; only the service's `checkReport` does.

## Goals / Non-Goals

**Goals:** carry `sources` and `evidence` from the facts to the payload; refuse what tskl.es would refuse, by field, before publishing; show the two totals in the summary; get agents counting each kind while they mine.

**Non-Goals:** changing what `surfaced` counts; any report-level total for the new kinds; making `sources` required in the facts; ranking one kind above another.

## Decisions

### D1: Kinds are a CLI table, held equal to the vendored schema by a test

`report/evidence.ts` lists the seven kinds with the group of each, and which kinds must carry a count; the facts schema builds its `sources` enum and `evidence` keys from that table. A test asserts the table's kinds equal the vendored schema's `sources` enum and that its `evidence` keys equal the schema's, so a refresh that adds a kind fails a test until the kind is given a group.

Alternative: build the facts enum from the vendored JSON at runtime, as `REPORT_FIXTURE_MAX_LENGTH` is read. Rejected during implementation: a JSON import types its enum as `string`, so the facts, `ReportRule` and the group table would lose the kind as a type, and a refresh that adds a kind still needs a hand edit to give it a group. One typed list, pinned to the schema by a test, is the same guarantee with the types intact.

### D2: Facts mirror the payload shape for these two fields

`sources` and `evidence` go on the shared `outcome` fields, so `rules`, `legacy` and `cloud` all take them, under the same names and shape as ReportV1. `assemble` copies them as given, adding no key when absent. They are agent-only facts (the CLI cannot see where a rule came from), so there is no CLI value to win a conflict with.

Alternative: one `evidence` object holding kinds and counts together, with `sources` derived. Rejected: `agent-files` and `conventions` may be listed without a count, so the list is not derivable from the counts, and a facts shape unlike the payload is one more thing the recipe has to explain.

### D3: The CLI repeats the service's cross-field checks

`assemble` refuses, under `REPORT_INVALID`, each condition the service's `checkSources`/`checkEvidence` refuses, naming the rule and the field:

- `sources` given on some rules but not all
- a kind listed twice
- `reviews` listed with no `surfaced.reviewComments` above zero
- `commits`, `issues`, `docs` or `tests` listed with no `evidence` count for it
- an `evidence` count whose kind `sources` does not list, or `evidence` with no `sources`

A refusal from tskl.es arrives after redaction and assembly, as a service error the agent has to map back to a fact; a refusal here names the fact. The checks run against the facts before redaction, like `checkWindow`.

Alternative: rely on the service. Rejected for the reason `checkWindow` exists. The risk is drift if the service tightens its checks; the service stays authoritative, so drift costs a later and less specific error, not a bad publish.

### D4: Summary totals per rule, beside the title

Each rule line gains its group totals, using the page's sums and words: reviews = `surfaced.reviewComments` + `evidence.commits` + `evidence.issues`; conventions = `evidence["agent-files"]` + `conventions` + `docs` + `tests`. Each is shown only when above zero, larger first, reviews first on a tie, "1 time" for one:

```
  - No direct fetch calls (Taskless ast-grep rule): 12 times in reviews, 3 times in conventions
```

The window-level "Raised in review" line stays as it is: it is about review comments and PRs only, which is still true.

Alternative: one "strongest evidence" phrase per rule, as #681 first suggested. Rejected, as the service rejected it: ranking kinds against each other has no basis, and the summary should read like the page it links to.

### D5: The recipes count while mining, one procedure per kind

`onboard`'s "Choosing candidates" already tells the agent to note PRs and comments under each candidate while mining. It now notes every call-out under the candidate with its kind, so `sources` and `evidence` come from the same list as `surfaced`, without a second read. "Evidence from commit history ... never counts" becomes: commits count as `commits` evidence, never as `surfaced`.

`report`'s "Counting surfaced" section becomes "Counting evidence", keeping the `surfaced` procedure unchanged and adding the call-out definition per kind from the table above, the window rule (commits inside `window`, other kinds as found at publish), and the privacy rule (kinds, never paths, file names, SHAs or issue titles). Section budgets apply: the long recipes are served as sections that fit one tool call, so the new text replaces rather than adds where it can.

## Risks / Trade-offs

- [The service tightens a check the CLI does not repeat] → the payload is still validated by tskl.es; the agent sees the service error instead of a field-named one. The checks are short and live in one file.
- [Agents count loosely, e.g. every file following a pattern] → the recipe defines a call-out per kind and says what does not count; counts stay self-reported like every count in a report.
- [Summing commits and issues into "times in reviews" overstates review activity] → the service's choice, mirrored so the terminal and the page agree; the line says "times", not "review comments".

## Migration Plan

None. The service shipped first; facts without the new fields keep producing the same payload.
