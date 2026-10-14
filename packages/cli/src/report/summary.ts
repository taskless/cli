import type { PerTier, ReportRule, ReportV1 } from "./types";

/**
 * The brief rule summary printed after a publish.
 *
 * A CLI template rather than prose the agent writes, so every report reads the
 * same and the recipe only has to say "show it". The page on tskl.es carries
 * the visual treatment; this is the companion a terminal can hold.
 *
 * The delete URL is deliberately absent. The summary names the record the CLI
 * can delete from, never the credential in it.
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

function total(perTier: PerTier): number {
  return perTier.cli + perTier.cloud + (perTier.legacy ?? 0);
}

export function renderSummary(options: {
  report: ReportV1;
  url: string;
  expiresAt: string;
  record: string;
  invocation: string;
}): string {
  const { report, url, expiresAt, record, invocation } = options;
  const { perMonth } = report.projection;
  const lines = [
    "Taskless report published",
    "",
    `Rules (${String(report.rules.length)}):`,
    ...report.rules.map((rule) => `  - ${rule.title} (${tierLabel(rule)})`),
    "",
    `Projected each month: ${String(total(perMonth.commentsPrevented))} review comments prevented, ${String(total(perMonth.agentCatches))} catches before review.`,
    "",
    `View it: ${url}`,
    `Expires: ${expiresAt.slice(0, 10)}`,
    "",
    "The report is unlisted: anyone with the link can view it.",
    `It can be deleted after review. Ask, or run \`${invocation} report --delete ${record}\`.`,
  ];
  return lines.join("\n");
}
