import { confirm, log } from "@clack/prompts";
import chalk from "chalk";

// Sets `chalk.level` from the real terminal on import. This module renders
// colour, so it establishes that itself rather than inheriting it from
// whichever caller happened to load `wizard/intro.ts` first.
import "../../util/color";

import type { InstallDiff } from "../../install/state";
import { ask } from "../ask";

export async function renderSummaryAndConfirm(
  diff: InstallDiff
): Promise<boolean> {
  const lines: string[] = [];

  for (const entry of diff.entries) {
    const hasAnyChange =
      entry.additions.skills.length > 0 ||
      entry.additions.commands.length > 0 ||
      entry.removals.skills.length > 0 ||
      entry.removals.commands.length > 0;

    if (!hasAnyChange && entry.unchanged.skills.length === 0) continue;

    lines.push(chalk.bold(entry.target));
    for (const skill of entry.additions.skills) {
      lines.push(`  ${chalk.green("+")} skill ${skill}`);
    }
    for (const command of entry.additions.commands) {
      lines.push(`  ${chalk.green("+")} command ${command}`);
    }
    for (const skill of entry.removals.skills) {
      lines.push(`  ${chalk.red("-")} skill ${skill}`);
    }
    for (const command of entry.removals.commands) {
      lines.push(`  ${chalk.red("-")} command ${command}`);
    }
    if (entry.unchanged.skills.length > 0) {
      lines.push(
        `  ${chalk.dim("·")} ${chalk.dim(
          `${entry.unchanged.skills.length} skill(s) unchanged`
        )}`
      );
    }
    lines.push("");
  }

  log.message(lines.join("\n") || "No changes.");

  if (!diff.hasRemovals) {
    return true;
  }

  return ask("summary", () =>
    confirm({
      message: buildRemovalConfirmMessage(diff),
      initialValue: true,
    })
  );
}

/**
 * Build an itemized removal confirmation: one clause per `reference` target
 * losing stubs, naming the directory and its removed stub count (skills +
 * commands). Canonical-store removals are excluded — they are not an
 * uninstall of a tool location, so "Remove Taskless from .taskless/" would be
 * misleading; when only canonical removals are present the message falls back
 * to a generic prompt. Only meaningful when {@link InstallDiff.hasRemovals}
 * is true.
 */
export function buildRemovalConfirmMessage(diff: InstallDiff): string {
  const clauses: string[] = [];
  for (const entry of diff.entries) {
    if (entry.mode === "canonical") continue;
    const count = entry.removals.skills.length + entry.removals.commands.length;
    if (count === 0) continue;
    clauses.push(
      `${entry.target}/ (${String(count)} stub${count === 1 ? "" : "s"})`
    );
  }
  if (clauses.length === 0) {
    return "Some files recorded in the previous install will be removed. Proceed?";
  }
  return `Remove Taskless from ${clauses.join(", ")}?`;
}
