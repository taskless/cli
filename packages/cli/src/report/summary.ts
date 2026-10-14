import type { ReportRule, ReportV1 } from "./types";

/**
 * The brief rule summary printed after a publish.
 *
 * A CLI template rather than prose the agent writes, so every report reads the
 * same and the recipe only has to say "show it". The page on tskl.es carries
 * the visual treatment; this is the companion a terminal can hold.
 *
 * The delete URL is deliberately absent. The summary names the record the CLI
 * can delete from, never the credential in it.
 *
 * No monthly rate either. tskl.es derives those, and a second copy of its
 * formula here is a number that drifts from the page without anyone noticing.
 * The summary states the two kinds of count it has, labelled apart: what the
 * CLI found in the code today, and what review raised over the window.
 */

function tierLabel(rule: ReportRule): string {
  switch (rule.tier) {
    case "cli": {
      return `Taskless ${rule.engine === "vale" ? "Vale" : "ast-grep"} rule`;
    }
    case "legacy": {
      return `rule in ${rule.tool ?? "your linter"}`;
    }
    case "cloud": {
      return "Taskless Cloud candidate";
    }
  }
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** What review raised over the window, summed across every rule. */
function surfacedLine(report: ReportV1): string {
  let prs = 0;
  let comments = 0;
  for (const rule of report.rules) {
    prs += rule.surfaced?.prs ?? 0;
    comments += rule.surfaced?.reviewComments ?? 0;
  }
  const { from, to } = report.scope.window;
  return `Raised in review from ${from} to ${to}: ${plural(comments, "comment", "comments")} across ${plural(prs, "pull request", "pull requests")}.`;
}

export function renderSummary(options: {
  report: ReportV1;
  url: string;
  expiresAt: string;
  record: string;
  invocation: string;
}): string {
  const { report, url, expiresAt, record, invocation } = options;
  const { findings } = report;
  const lines = [
    "Taskless report published",
    "",
    `Rules (${String(report.rules.length)}):`,
    ...report.rules.map((rule) => `  - ${rule.title} (${tierLabel(rule)})`),
    "",
    ...(findings === undefined
      ? []
      : [
          `Found in the code today: ${plural(findings.violations, "problem", "problems")} in ${plural(findings.files, "file", "files")}.`,
        ]),
    surfacedLine(report),
    "",
    `View it: ${url}`,
    `Expires: ${expiresAt.slice(0, 10)}`,
    "",
    "The report is unlisted: anyone with the link can view it.",
    `It can be deleted after review. Ask, or run \`${invocation} report --delete ${record}\`.`,
  ];
  return lines.join("\n");
}
