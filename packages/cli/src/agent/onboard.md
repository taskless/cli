# Topic: onboard     (CLI v%(CLI_VERSION)s / topic v9)

%(ONE_COMMAND_PER_CALL)s

## Goal
Take a user who has just installed Taskless from zero rules to a
working starter set and a published report, after asking them one
question. Mine the codebase, agent-memory files, review history, and
any tracker or engineering context you can reach for high-signal rule
candidates; write every one this repository can enforce locally;
publish a Taskless report showing what they catch; and finish by
making the case for running them in CI.

## Preconditions
- `.taskless/` directory exists (Taskless is installed). The
  `%(TASKLESS_CLI)s onboard` subcommand bootstraps it on first run, so this
  is automatically satisfied.
- A working repository the agent can read.
- No auth, ever. Onboarding runs logged out from start to finish: do
  not run `auth login`, and do not offer it. Everything below works
  without an account.
- The criterion for where a rule belongs lives in
  `%(TASKLESS_CLI)s agent route` and is not restated here. This recipe
  reads it; it does not duplicate it.

## Steps

1. **Read the manifest first.** Run
   `%(TASKLESS_CLI)s info --json` and check whether
   `.taskless/taskless.json` reports `install.onboarded: true`. The
   `%(TASKLESS_CLI)s onboard` subcommand has already gated on this for
   you; if you reached this recipe another way and it is true, stop and
   tell the user onboarding already ran.

2. **Ask the one question.** Put exactly this to the user, word for
   word, set apart from anything else you say by a blank line above
   and below:

   I'd look through your repo, your agent files such as CLAUDE.md, any documentation, relevant PRs if I have access, and any additional bug tracking that might help us build a set of rules. From this, I'll create starter rules in `.taskless/` (all local, no login) and then generate a report.

   Do you want me to set up Taskless for you?

   Do not reword it, add to it, or describe the sources or steps in
   your own words; this paragraph is the whole introduction. If your
   host has a structured question tool, ask it through that tool, with
   the paragraph before the question; otherwise ask it as plain text.
   A yes covers everything that follows: mining the repository,
   writing rules, publishing an unlisted report to tskl.es, and
   sending Taskless anonymous feedback about how onboarding went. On
   anything other than a yes, stop.

   This is the only question you script. Do not ask which sources to
   mine, whether to write each rule, or whether to mark onboarding
   complete. Two exceptions follow: clarifying questions when the
   report cannot be built (step 8), and the CI offer at the very end
   (step 11).

3. **Learn the routing surface before you propose anything.** A
   candidate this repository cannot express is not a candidate, and
   you cannot tell which is which until you know two things:

   ```
   %(TASKLESS_CLI)s agent route
   %(TASKLESS_CLI)s detect --json
   ```

   Read `route` for the destination criterion, which rules are
   decided by one file's syntax tree, by a document's words, by a
   tool the repo already runs, or by evidence outside the files.
   Read `detect --json` for what this repository actually has:
   `linters`, `languages`, `ruleStyles`, `hostTools`, and `agent`,
   the commands you may choose to run to check that a source is
   usable, such as whether the user is signed in to `gh`.

4. **Mine every source you can reach.** Do not ask the user which;
   use all of these that apply:

   - **Codebase TODOs / FIXMEs**: search for `TODO`, `FIXME`, `XXX`,
     and `HACK` comments. Many of these are latent rules ("don't do
     this", "remove when X").
   - **Agent-memory files**: read `CLAUDE.md`, `AGENTS.md`,
     `.cursorrules`, `.opencode/AGENTS.md`, and similar agent-context
     files for explicit rules and conventions stated in prose.
   %(SOURCE_PR_REVIEW)s
   - **Commit history**: read the commit messages over the same window
     for fixes that recur: the same missing header added again, the
     same call swapped out again, the same mistake reverted again. A
     fix that keeps being made is as strong a candidate as a review
     comment that keeps being written. In a repository reviewed before
     its pull requests open, or written mostly by agents, it is often
     the only one. `git` is all this needs.
   - **Trackers and engineering context**: Taskless cannot see your
     MCP roster, so this is your call. Use every MCP you have that
     reaches a bug tracker (Jira and Linear are examples of the class,
     not the expected answer), an engineering-context tool, or
     recorded architectural decisions. A self-hosted tracker behind an
     MCP counts exactly the same.

   Whether to run a command `detect` lists under `agent`, and which
   MCPs to use, is yours to decide. Run a check when its answer
   changes what you can mine.

5. %(HOST_TOOLS)s

6. **Scan with high-signal filtering.** For each source:

   - **Filter for repeated patterns.** A reviewer comment that
     appears across multiple PRs is a much stronger rule candidate
     than a one-off nit.
   - **Prefer comments that cite a doc or style guide.** "Per our
     style guide, no direct DB calls in controllers" is a rule.
     "looks good" is not.
   - **Prefer merge-blocking feedback.** Comments that gated a PR
     merge are higher-signal than passing remarks.
   - **Filter out one-off nits and pure formatting.** Linters and
     formatters already handle those; Taskless rules earn their
     keep on semantic patterns.

   Keep, for yourself, a list of candidates in this form, ordered by
   impact (frequency in the source × severity × ease of enforcement):

   ```
   - <kebab-case-name> [<destination>]: <one-line description of what it would enforce>
   ```

   `<destination>` is your provisional routing call, one of `legacy`,
   `sg`, `vale`, or `runtime`. `route` decides for real when you write
   the rule, and may land it somewhere else. Three high-quality
   candidates beat ten speculative ones. Note, for the report, how
   many pull requests and review comments raised each one in the
   window you mined: a pull request counts when it merged in the
   window and a review comment on it asked for the change, and each
   such comment counts. Bot and author comments count too. Judge each
   comment by reading it, never by matching keywords. Evidence from
   commit history chooses candidates; it never counts toward these
   numbers, which count review comments alone.

7. **Write the rules.** For every candidate whose destination is
   `legacy`, `sg`, or `vale`, follow the `%(TASKLESS_CLI)s agent route`
   recipe you already fetched, with the candidate as the rule
   description, and write it. Do not ask before each one.

   A candidate you judge better solved by a runtime rule is not
   written: runtime rules need an account, and onboarding stays
   logged out. If `route` sends a rule toward a runtime or
   login-gated recipe, stop there for that rule. Keep it for the
   report, where it appears as a Taskless Cloud candidate, and note how
   many instances of its pattern you saw in the code: the report asks
   for that estimate.

8. **Clarify only when stuck.** You may ask the user something only
   when you are unsure what rules to write AND the report cannot be
   built yet because there are fewer than three working Taskless
   rules. Ask only what would let you write the missing rules, then
   write them. If you can find good candidates on your own, do that
   instead.

9. **Mark onboarding complete.** Once the rules are written, run:

   ```
   %(TASKLESS_CLI)s onboard --mark-complete
   ```

   Do not ask first. The user's yes in step 2 is the consent this
   records, and it does not wait on the report.

10. **Publish the report, and send feedback alongside it.** Follow
    `%(TASKLESS_CLI)s agent report` to publish the report; it carries
    the runtime candidates from step 7 as Taskless Cloud candidates.
    In parallel, follow `%(TASKLESS_CLI)s agent rule-feedback` as the
    respondent, reached from onboarding: answer from your own account
    of this session, ask the user nothing, and send it. If the report
    recipe refuses for too few rules, that is step 8's case.

11. **Make the case for CI, last.** After the report summary has been
    shown, offer to run `%(TASKLESS_CLI)s check` in this repository's CI
    by following `%(TASKLESS_CLI)s agent ci`, naming the CI systems the
    `ci` field of `detect --json` reported, or saying there are none.
    Encourage it strongly: these rules only keep agents from
    reintroducing what the report shows when something runs them on
    every change, and CI is where every agent's work passes through.
    On a yes, follow the `ci` recipe. On a no, name
    `%(TASKLESS_CLI)s agent hooks` in one line as the way to run them
    before each commit instead, and stop.

## Errors

| code                  | meaning                                      | fix                                                  |
|-----------------------|----------------------------------------------|------------------------------------------------------|
| `ALREADY_ONBOARDED`   | `install.onboarded` is true and no `--force` | tell the user onboarding already ran                 |
| `REPORT_INSUFFICIENT` | fewer than three working Taskless rules      | step 8: write more rules, asking only if you're stuck |

## See Also

- `%(TASKLESS_CLI)s agent route`: the destination criterion; read it
  before proposing candidates, and follow it to write each one
- `%(TASKLESS_CLI)s agent report`: publish the report onboarding ends with
- `%(TASKLESS_CLI)s agent rule-feedback`: the feedback sent alongside it
- `%(TASKLESS_CLI)s agent detect`: what this repository already lints
  and authors, which bounds what a candidate can be
- `%(TASKLESS_CLI)s agent ci`: run the rules in CI, the closing offer
- `%(TASKLESS_CLI)s agent hooks`: run the rules on staged files before each commit
- `%(TASKLESS_CLI)s agent info`: inspect the current `.taskless/taskless.json` state
