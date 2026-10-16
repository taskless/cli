## Why

Testing onboarding on a C#/.NET repository (#520) produced a report that priced every rule at $0 next to 114 findings in the code today. The agent followed the recipes correctly. The repository reviews its changes before a pull request opens, and agents write about half of them, so its 131 merged PRs held 12 comments, none asking for any rule's change. tskl.es derives its estimate from `surfaced` alone, so every rule priced at zero. The user read the page as "Taskless does nothing for us".

The recipes made that outcome worse in two ways:

- **Onboarding never names commit history as a source.** In this repository the real signal was in its commits: at least four separate commits added missing license headers. The recipe sends the agent to review comments for recurring patterns and says nothing about recurring fixes.
- **The report recipe never prepares the agent for an all-zero `surfaced`.** The agent showed the summary as printed and said nothing more, so a $0 estimate stood unexplained. The tester also had evidence of value from `git blame` and no field to put it in. They correctly kept it out of `surfaced`, but the recipe should say so rather than rely on that judgement.

Pricing introductions measured from history, and a page that says "unmeasured" instead of "$0", both need changes to the ReportV1 contract and to tskl.es. Those changes are out of scope here. This change fixes what the recipes control.

## What Changes

- **Onboard topic v7 → v8**: step 4 names **commit history** as a source. Fixes that recur in the window's commits are as strong a candidate as review comments that recur, and in a repository reviewed before its pull requests open, or written mostly by agents, they are often the only one. The scan step states that commit evidence chooses candidates and never counts toward `surfaced`.
- **Report topic v2 → v3**: `## Counting surfaced` states that only review comments count. A fix-up commit, a blame date, or a finding today is not one, and the facts have no field for it. Step 4 adds a line for when every `surfaced` count is zero: the agent tells the user the estimate is $0 because review in the window raised none of these patterns, not because the rules catch nothing, and points to the findings in the code today.

No CLI surface, schema, or payload changes.

## Capabilities

### Modified Capabilities

- `cli-onboard`: "Onboard recipe follows the canonical recipe template and asks one question" adds commit history to the mined sources and keeps it out of `surfaced`. It also moves to topic v8; the spec had stayed at v6 while the recipe moved to v7.
- `cli-report`: "The report recipe drives the flow" states that only review comments count toward `surfaced`, and requires the all-zero explanation.

## Delivery Shape

**Single PR.** The change is recipe text, its spec, and its tests, and is safe in production on its own. The package is pre-1.0 and nothing here is new surface a consumer must react to, so the bump is `patch`.

## Impact

- **Recipes**: `packages/cli/src/agent/onboard.md`, `packages/cli/src/agent/report.md`.
- **Tests**: `packages/cli/test/onboard.test.ts`, `packages/cli/test/report.test.ts`.
- **Follow-up, not in this change**: a ReportV1 field for introductions measured from history (blame of each finding against the window), and tskl.es rendering "unmeasured" when every value input is zero. Both need the tskl.es side.
