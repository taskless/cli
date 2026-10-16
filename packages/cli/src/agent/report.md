# Topic: report     (CLI v%(CLI_VERSION)s / topic v3)

## Goal
Publish a Taskless report: an unlisted page on tskl.es that shows what
this repository's Taskless rules catch, built from what the CLI can
measure plus what you learned in this session. Then show the user the
CLI's short summary and the link. The same recipe regenerates a report
later and deletes one on request.

## Preconditions
- At least three working Taskless rules: `sg` or `vale` rules under
  `.taskless/rules/`, or rules you wrote into the repository's own
  linter. The CLI enforces this and tells you when it is not met.
- No auth required. Publishing does not log in and is not tied to an
  account.
- tskl.es does NOT redact anything. Whatever you put in the facts file,
  and every fixture the CLI publishes, is visible to anyone with the
  link. The CLI withholds what its patterns catch; anything you cannot
  vouch for beyond that is yours to withhold.

## Steps

1. **See what the CLI already knows.** Run:

   ```
   %(TASKLESS_CLI)s report
   ```

   It prints a JSON draft: the repository scope, every rule under
   `.taskless/rules/` with its engine, language, test status and first
   fixtures, and `missing`, the facts only you can supply. Read
   `missing`; it is the checklist for the next step.

   The draft also carries what the rules find in the code today:
   `violations` and `files` on each rule, and `findings` across all of
   them, counted by the CLI's own scan. You cannot supply or change
   these. When they are absent, `unmeasured` says why, and the report
   publishes without them.

2. **Supply what is missing.** Write
   `.taskless/.tmp-report.json` following the schema below. Every entry
   comes from this session or from sources you can reach now, never
   from guesswork you present as measurement:

   - `window`: the span of history you mined, as dates.
   - `history`: what that window held. Merged pull or merge requests,
     review comments, the ones an agent helped write, and how many
     recurring review patterns were rule-shaped versus judgment calls.
     Zeros are honest when there was nothing to mine.
   - `rules`: one entry per rule the draft listed, with a title a
     reader understands and its `surfaced` counts, counted as described
     under `## Counting surfaced`.
   - `legacy`: rules you wrote into the repository's own linter, which
     the CLI cannot see.
   - `cloud`: runtime-shaped candidates you judged better solved by a
     runtime rule and did not author. Count their `surfaced` the same
     way. Give each one `estimatedViolations`: how many instances of
     its pattern you estimate are in the code today, from what you saw
     while mining. No rule has run, so this is an estimate, and it is
     published as one. Zero is honest if you proposed the candidate
     from review alone and saw no instance in the code.
   - `redaction`: what you removed yourself, by kind, and any fixture
     you choose not to publish. Names of people and customers are
     yours to judge; the CLI's patterns cannot see them.

3. **Generate.** Run:

   ```
   %(TASKLESS_CLI)s report --from .taskless/.tmp-report.json
   ```

   On failure it prints `Error (<code>): <message>`. Handle the code
   from the table under `## Errors`.
   `REPORT_INSUFFICIENT` is the only one that may involve the user: if
   you are unsure what further rules to write, ask the user only what
   would let you write the rules the message says are missing, write
   them, and run this step again. Otherwise write the rules without
   asking.

4. **Show the result.** On success the CLI prints a short summary: the
   rules, what they found in the code today, what review raised over
   the window, the link, and when it expires. Show it to the user
   exactly as printed. Then tell them, in one line, that the report can
   be deleted after they have reviewed it, and that they only need to
   ask.

   If you restate any of the report's numbers in your own words, keep
   the kinds apart and label each: counts the CLI found **in the code
   today**, counts mined **from review over the window**, and a cloud
   candidate's instances, which are **your estimate**. A rule with 75
   violations today that was raised in 23 pull requests has two
   different numbers, and neither is the other.

5. **Clean up.** Delete `.taskless/.tmp-report.json`. The CLI kept a
   record of the report in `.taskless/reports/`, which is gitignored
   because it holds the URL that deletes the page. Do not print or
   paste that file's contents.

6. **Delete on request.** If the user asks to delete the report, run:

   ```
   %(TASKLESS_CLI)s report --delete <record>
   ```

   `<record>` is the file name the summary named, under
   `.taskless/reports/`. The record is removed only once tskl.es
   confirms the deletion. Tell the user cached copies of the page may
   be served for up to a day afterwards.

## Counting surfaced

Every agent counts `surfaced` the same way, so reports from different
sessions compare:

- **`surfaced.prs`**: pull or merge requests merged inside `window`
  with at least one review comment asking for the change the rule
  enforces.
- **`surfaced.reviewComments`**: the review comments on those pull
  requests that ask for that change. Count inline review comments and
  review bodies.
- **Every author counts.** A comment from a bot account or from the
  pull request's own author counts the same as a reviewer's: each one
  spent cycles, tokens, time, or money.
- **Judge each comment by reading it.** A comment counts when a reader
  would say it asks for the change the rule enforces. Do not match
  keywords: "fixed" or "removed" in a reply says nothing about which
  rule it concerns.
- A comment that asks for two rules' changes counts once for each.
- **Only review comments count.** A fix-up commit, a `git blame`
  date, or a finding in the code today is not a review comment,
  however well it shows what the rule is worth. The facts have no
  field for it; leave it out rather than count it as review.

## Facts schema

The `--from` JSON file conforms to:

```json
%(INPUT_SCHEMA)s
```

## Errors

| code                     | meaning                                                         | fix                                                                       |
|--------------------------|-----------------------------------------------------------------|---------------------------------------------------------------------------|
| `REPORT_INSUFFICIENT`    | fewer than three working Taskless rules                         | write the missing rules (step 3), then retry                              |
| `REPORT_INVALID`         | the facts file, or the assembled report, failed validation      | the message names each field; fix the facts file and retry                |
| `REPORT_REDACTION`       | a title or label you wrote looks like it holds a secret or contact detail | rewrite the field the message names without it                    |
| `REPORT_TOO_LARGE`       | the report is over tskl.es's size limit                         | withhold long fixtures or drop cloud candidates, then retry               |
| `REPORT_RATE_LIMITED`    | tskl.es is limiting publishes from this address                 | wait a minute, then retry                                                 |
| `REPORT_PUBLISH_FAILED`  | tskl.es could not store the report; nothing was published       | retry later                                                               |
| `REPORT_PUBLISH_UNKNOWN` | publishing timed out; a report may exist                        | tell the user; do not retry on your own, since a retry may duplicate it  |
| `REPORT_NOT_FOUND`       | no record by that name in `.taskless/reports/`                  | list the directory and use a file name from it                            |
| `REPORT_NOT_AVAILABLE`   | tskl.es has no report for that delete URL                       | it was already deleted, expired, or has not propagated yet; do not retry  |
| `REPORT_DELETE_FAILED`   | tskl.es did not delete the report                               | the record is kept; retry later                                           |

## See Also

- `%(TASKLESS_CLI)s agent onboard`: the onboarding flow that ends by
  publishing a report
- `%(TASKLESS_CLI)s agent route`: how to author a rule, when the report
  needs more of them
- `%(TASKLESS_CLI)s agent ci`: run the rules in CI, so they keep
  catching what the report shows
