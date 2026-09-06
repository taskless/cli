// SPDX-License-Identifier: MIT
"use strict";

/**
 * OpenSpec tracking planner: decide which tracking issues to open, reopen,
 * escalate, or close for unarchived changes under `openspec/changes/`.
 *
 * WHY THIS EXISTS. An unarchived change directory on `main` is not a chore left
 * undone. It means `openspec/specs/` is currently wrong: some of the
 * requirements written there are already met by shipped code, and the standing
 * spec still describes the world before it.
 *
 * Three earlier attempts reported that through a check status and all three
 * were deleted in 8d1f3a1. A pull-request gate had to infer stack position; a
 * step in `Validate` ran `main` red for as long as a forward-merging stack took
 * to drain; a daily sweep split changes into DONE and STALE to guess whether
 * unfinished work was abandoned or merely slow. The predicates were roughly
 * right. The channel was not: a signal expected to be red is not a signal.
 *
 * So nothing here fails a run. The output is a plan, and the workflow executes
 * it against the issues API.
 *
 * WHAT DECIDES. In `push` mode, a change is a fault when it is unarchived AND
 * no open pull request's diff touches its directory. That claim test is what
 * keeps a draining stack quiet: measured on the stack that landed 2026-09-04,
 * pull requests 265, 266 and 267 touched 6, 2 and 6 files under
 * `openspec/changes/`, because every slice ticks its own boxes in `tasks.md`,
 * which lives in the change directory. It is a file-path question about open
 * pull requests, not a reconstruction of stack lineage.
 *
 * In `sweep` mode the claim test is not consulted. Age stands alone, read from
 * the last git activity in the change directory, so an active stack keeps
 * resetting its own clock and only stalled work crosses the window.
 *
 * NO `tasks.md` PARSING, DELIBERATELY. There is no parked state on `main`: a
 * change is finished or it has not landed. Measured over the archive, task
 * checkboxes are a discipline signal rather than a completion signal, with 5 of
 * 55 archived changes carrying 1 to 3 unchecked stragglers out of 22 to 37
 * tasks. Reading them re-introduces the intent-guessing that got the previous
 * sweep deleted.
 *
 * THE PLAN CARRIES ITS OWN PROSE. Titles, bodies and comments are rendered
 * here rather than in the workflow. Shell heredocs nested inside a YAML block
 * scalar inside a loop are the wrong place to compose multi-paragraph text, and
 * rendering here means the wording is covered by the tests beside this file.
 *
 * Usage:
 *   node .github/scripts/openspec-tracking.cjs < input.json
 *   node .github/scripts/openspec-tracking.cjs --list [changesDirectory]
 *
 * The second form is the one three workflows call to list unarchived change
 * directories: it prints `listUnarchivedChanges()` as a sorted JSON array of
 * names on stdout, and nothing else. That routes the listing through
 * `readdirSync`, which behaves the same on every platform `node` runs on,
 * rather than through a shell `find`, where `-printf` is a GNU extension that
 * a checkout under BSD find (macOS) does not recognise. A missing changes
 * directory prints `[]` and exits zero; an unreadable one throws and exits
 * non-zero, and the calling workflow turns that into a `::warning::`
 * annotation rather than either an empty list or a failed run.
 *
 * Reads one JSON object on stdin and prints the plan as JSON on stdout:
 *
 *   {
 *     "mode": "push" | "sweep",
 *     "sha": "abc1234",
 *     "staleDays": 7,
 *     "unarchived": [{ "name": "some-change", "ageDays": 3 }],
 *     "pulls": [{ "number": 265, "files": ["openspec/changes/some-change/tasks.md"] }],
 *     "issues": [{ "number": 12, "state": "open", "body": "<!-- openspec-tracking:some-change -->", "idleDays": 9 }]
 *   }
 *
 * `claims` may be supplied directly instead of `pulls` when the caller has
 * already reduced them, and an issue may carry `change` directly instead of a
 * `body` to parse. `idleDays` is how long the issue has gone without activity,
 * and throttles sweep escalations to at most one per window.
 *
 * Always exits zero on a well-formed input. A malformed input is a defect in
 * the caller and exits non-zero, which is the one case where silence would hide
 * that the check never ran.
 */

const { readdirSync, existsSync, readFileSync } = require("node:fs");

const ARCHIVE_DIRECTORY = "archive";
const DEFAULT_STALE_DAYS = 7;

/**
 * The marker carried in an issue body so the workflow can find that issue again
 * without matching on its title. A title is editable by anyone reading the
 * issue, and a retitled issue would be invisible, which produces a second issue
 * for the same change rather than an update to the first.
 */
function marker(change) {
  return `<!-- openspec-tracking:${change} -->`;
}

/**
 * Read the marker back out of an issue body. Returns undefined when the body
 * carries none, so an unrelated issue can never be adopted and then closed by
 * this workflow.
 */
function changeFromBody(body) {
  const found = /<!-- openspec-tracking:([^\s>]+) -->/.exec(body ?? "");
  return found === null ? undefined : found[1];
}

/**
 * Every directory under `openspec/changes/` other than `archive/`. A missing
 * changes directory is not a fault: a repository with no OpenSpec work in
 * flight is the state this whole mechanism exists to reach.
 */
function listUnarchivedChanges(changesDirectory) {
  if (!existsSync(changesDirectory)) {
    return [];
  }
  return readdirSync(changesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== ARCHIVE_DIRECTORY)
    .map((entry) => entry.name)
    .sort();
}

/**
 * Which changes a set of pull requests claims. `files` is the paths a pull
 * request's diff against `main` touches; touching anything under a change's
 * directory claims it.
 */
function claimsFromPullRequests(pullRequests) {
  const claims = {};
  for (const pullRequest of pullRequests) {
    for (const path of pullRequest.files ?? []) {
      const found = /^openspec\/changes\/([^/]+)\//.exec(path);
      if (found === null || found[1] === ARCHIVE_DIRECTORY) {
        continue;
      }
      const change = found[1];
      claims[change] = claims[change] ?? [];
      if (!claims[change].includes(pullRequest.number)) {
        claims[change].push(pullRequest.number);
      }
    }
  }
  return claims;
}

function issueTitle(change) {
  return `OpenSpec: ${change} is unarchived on main`;
}

function issueBody(change, sha) {
  return [
    marker(change),
    "",
    `\`openspec/changes/${change}/\` is on \`main\` and is not archived, and no open`,
    "pull request is still working on it.",
    "",
    "**The standing specs are wrong right now.** Some of the requirements in",
    "`openspec/specs/` are already met by code that shipped, and the spec still",
    "describes the world before it. Archiving is what reconciles them.",
    "",
    "```bash",
    `pnpm openspec archive ${change}`,
    "```",
    "",
    "Before archiving, read the pre-archive check in `CLAUDE.md`. A",
    "`## MODIFIED Requirements` block replaces a standing requirement wholesale and",
    "silently deletes any scenario it leaves out.",
    "",
    `Last seen on \`${sha ?? "an unrecorded commit"}\`. This issue closes itself when the`,
    "change reaches `openspec/changes/archive/`.",
  ].join("\n");
}

function reopenComment(change, sha) {
  return `Seen again on \`${sha ?? "an unrecorded commit"}\`: \`${change}\` is unarchived on \`main\` with no open pull request working on it.`;
}

function escalateComment(change, ageDays, staleDays) {
  return [
    `Still unarchived. \`openspec/changes/${change}/\` has had no git activity for ${ageDays} days,`,
    `past the ${staleDays}-day window.`,
    "",
    "The scheduled sweep reports this on age alone. There is no parked state on",
    "`main`, so an unfinished change sitting here is the same fault as a finished",
    "one: the standing specs describe requirements the shipped code has already met.",
  ].join("\n");
}

function closeComment(action, sha) {
  if (action.reason === "archived") {
    return `Archived. \`${action.change}\` reached \`openspec/changes/archive/\` on \`${sha ?? "an unrecorded commit"}\`, so the standing specs and the shipped code agree again.`;
  }
  const claimants = (action.claimants ?? []).join(", ");
  return `Claimed again on \`${sha ?? "an unrecorded commit"}\` by pull request(s) ${claimants}. Closing, because the change is no longer unclaimed. The next push after that work lands re-evaluates.`;
}

/**
 * Read the tracking issues into the shape the planner matches on.
 *
 * The marker is parsed HERE and nowhere else. Both workflows used to
 * re-implement this regex as a `jq capture(...)`, which put three copies of one
 * format string in three files with nothing keeping them in sync, and `capture`
 * drops a non-matching element from the array rather than erroring, so an issue
 * whose body stopped matching would read as "no issue exists" and produce a
 * duplicate instead of a failure.
 *
 * An issue with no marker is not ours and is ignored. That is the same outcome
 * `jq` produced, but it is now a decision made in one place with a test on it.
 */
function normalizeIssues(issues) {
  return issues
    .map((issue) => ({
      number: issue.number,
      state: String(issue.state ?? "open").toLowerCase(),
      change: issue.change ?? changeFromBody(issue.body),
      idleDays: issue.idleDays,
    }))
    .filter((issue) => issue.change !== undefined);
}

function findIssue(issues, change) {
  return issues.find((issue) => issue.change === change);
}

/**
 * The plan. Each action names one change and one thing to do to its issue, and
 * carries the text the workflow needs to send.
 *
 * `close` carries a reason because the two cases read differently to whoever
 * finds the issue later: `archived` is the success path, and `claimed` means
 * work resumed on a change that had been reported as abandoned.
 */
function planActions(input) {
  const mode = input.mode;
  if (mode !== "push" && mode !== "sweep") {
    throw new Error(`unknown mode: ${String(mode)}`);
  }
  const sha = input.sha;
  const staleDays = input.staleDays ?? DEFAULT_STALE_DAYS;
  const unarchived = input.unarchived ?? [];
  const claims =
    input.claims ?? claimsFromPullRequests(input.pulls ?? []);
  const issues = normalizeIssues(input.issues ?? []);
  const actions = [];
  const seen = new Set();

  for (const change of unarchived) {
    const name = change.name;
    seen.add(name);
    const issue = findIssue(issues, name);
    const claimants = claims[name] ?? [];

    if (mode === "sweep") {
      // Age stands alone here. An active stack touches its own change
      // directory on every slice, so its age never reaches the window.
      const ageDays = change.ageDays ?? 0;
      if (ageDays < staleDays) {
        continue;
      }
      if (issue === undefined) {
        actions.push({
          type: "open",
          change: name,
          title: issueTitle(name),
          body: issueBody(name, sha),
        });
        continue;
      }
      // Escalate at most once per window. `ageDays` only grows, so without this
      // every daily run past the window appends another near-identical comment
      // forever, and a notification a day is not a durable signal. Any activity
      // on the issue also defers the next one: a thread someone is already
      // working in does not need the bot restating the age.
      if ((issue.idleDays ?? Number.POSITIVE_INFINITY) < staleDays) {
        continue;
      }
      actions.push({
        type: "escalate",
        change: name,
        issue: issue.number,
        ageDays,
        comment: escalateComment(name, ageDays, staleDays),
      });
      continue;
    }

    if (claimants.length > 0) {
      // Claimed again. An issue opened while nothing claimed the change is now
      // wrong, so it closes rather than sitting open against active work.
      if (issue !== undefined && issue.state === "open") {
        const action = {
          type: "close",
          reason: "claimed",
          change: name,
          issue: issue.number,
          claimants,
        };
        actions.push({ ...action, comment: closeComment(action, sha) });
      }
      continue;
    }

    if (issue === undefined) {
      actions.push({
        type: "open",
        change: name,
        title: issueTitle(name),
        body: issueBody(name, sha),
      });
    } else if (issue.state === "closed") {
      actions.push({
        type: "reopen",
        change: name,
        issue: issue.number,
        comment: reopenComment(name, sha),
      });
    }
  }

  // An open issue for a change that is no longer under `openspec/changes/` has
  // been archived. This is the success path and the only way an issue closes
  // without a human.
  for (const issue of issues) {
    if (issue.state === "open" && !seen.has(issue.change)) {
      const action = {
        type: "close",
        reason: "archived",
        change: issue.change,
        issue: issue.number,
      };
      actions.push({ ...action, comment: closeComment(action, sha) });
    }
  }

  return { mode, staleDays, actions };
}

function main(raw) {
  const input = JSON.parse(raw ?? readFileSync(0, "utf8"));
  return planActions(input);
}

const DEFAULT_CHANGES_DIRECTORY = "openspec/changes";

/**
 * `--list` mode. Prints `listUnarchivedChanges(changesDirectory)` as a JSON
 * array on stdout, and nothing else, so a caller can pipe stdout straight
 * into `jq` without stripping any other output.
 *
 * A missing directory is not a fault (see `listUnarchivedChanges`) and prints
 * `[]`. An unreadable one throws out of `readdirSync`, which this
 * deliberately does not catch: letting it propagate is what turns it into a
 * non-zero exit for `require.main` to report, which is the signal the calling
 * workflow needs to tell "nothing to report" apart from "could not tell".
 */
function runList(changesDirectory) {
  process.stdout.write(
    `${JSON.stringify(listUnarchivedChanges(changesDirectory))}\n`
  );
}

module.exports = {
  ARCHIVE_DIRECTORY,
  DEFAULT_STALE_DAYS,
  marker,
  changeFromBody,
  listUnarchivedChanges,
  claimsFromPullRequests,
  normalizeIssues,
  issueTitle,
  issueBody,
  planActions,
  main,
  runList,
};

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--list") {
      runList(args[1] ?? DEFAULT_CHANGES_DIRECTORY);
    } else {
      process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
    }
  } catch (error) {
    console.error(`openspec-tracking failed: ${error.message}`);
    process.exitCode = 1;
  }
}
