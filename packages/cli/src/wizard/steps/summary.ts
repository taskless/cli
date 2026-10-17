import { confirm, log } from "@clack/prompts";
import chalk from "chalk";

// Sets `chalk.level` from the real terminal on import. This module renders
// colour, so it establishes that itself rather than inheriting it from
// whichever caller happened to load `wizard/intro.ts` first.
import "../../util/color";

import {
  describeGlobalTrust,
  needsWrite,
  type GlobalTrustOutcome,
} from "../../install/global-trust";
import { commandOfRule, type PermissionEdit } from "../../install/permissions";
import { wrap } from "../../install/notice-box";
import type { InstallDiff } from "../../install/state";
import { ask } from "../ask";

export async function renderSummaryAndConfirm(
  diff: InstallDiff,
  permissions: readonly PermissionEdit[] = [],
  globalTrust?: { outcomes: readonly GlobalTrustOutcome[]; home: string }
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

  // Every settings edit, project and global, in one group under one
  // question: each is a line a person can read, with where it goes.
  const settingsLines = layoutSettings([
    ...describeProjectEdits(permissions),
    ...(globalTrust === undefined
      ? []
      : describeGlobalTrust(globalTrust.outcomes, globalTrust.home).map(
          ({ replace, what, where }): SettingsLine => ({
            label: replace ? "REPLACE (global):" : "ALLOW (global):",
            tone: "allow",
            what,
            where,
          })
        )),
  ]);
  if (settingsLines.length > 0) {
    lines.push(chalk.bold("Agent settings"), ...settingsLines, "");
  }

  log.message(lines.join("\n") || "No changes.");

  // A settings file is the user's, so an edit to one is confirmed even when
  // nothing is being removed.
  const editsSettings =
    permissions.some((edit) => edit.skipped === null) ||
    (globalTrust?.outcomes.some((outcome) => needsWrite(outcome)) ?? false);
  if (!diff.hasRemovals && !editsSettings) {
    return true;
  }
  return ask("summary", () =>
    confirm({
      message: diff.hasRemovals
        ? buildRemovalConfirmMessage(diff, { editsSettings })
        : SETTINGS_QUESTION,
      initialValue: true,
    })
  );
}

const SETTINGS_QUESTION = "Make these changes to your settings?";

/** One settings edit: what it allows or removes, and where. */
interface SettingsLine {
  label: string;
  tone: "allow" | "remove" | "skip";
  what: string;
  where: string;
}

/**
 * Lines inside clack's gutter stay within this many columns, so the summary
 * fits an 80-column terminal.
 */
const SUMMARY_COLUMNS = 76;

const TONE = { allow: chalk.green, remove: chalk.red, skip: chalk.yellow };

/**
 * Labels padded to the widest one, so every statement starts in one column,
 * and each statement wrapped under itself, never mid-token: a nightly version
 * is one long token and must stay copyable.
 */
function layoutSettings(entries: readonly SettingsLine[]): string[] {
  const width = Math.max(0, ...entries.map((entry) => entry.label.length)) + 1;
  const indent = " ".repeat(width);
  const lines: string[] = [];
  for (const entry of entries) {
    const body = [
      ...wrap(entry.what, SUMMARY_COLUMNS - width),
      ...wrap(entry.where, SUMMARY_COLUMNS - width),
    ];
    const [first = "", ...rest] = body;
    lines.push(
      `${TONE[entry.tone](entry.label)}${" ".repeat(width - entry.label.length)}${first}`,
      ...rest.map((line) => `${indent}${line}`)
    );
  }
  return lines;
}

/**
 * Each project permission edit as one entry per command and file. A harness
 * whose rules come in two spellings (Cursor's CLI writes the command bare and
 * with arguments) reads as one entry, since both allow the same command.
 */
function describeProjectEdits(
  edits: readonly PermissionEdit[]
): SettingsLine[] {
  const entries: SettingsLine[] = [];
  for (const edit of edits) {
    if (edit.skipped !== null) {
      entries.push({
        label: "SKIPPED (project):",
        tone: "skip",
        what: edit.file,
        where: edit.skipped,
      });
      continue;
    }
    const where = `in ${edit.file}`;
    for (const what of new Set(edit.allowed.map((r) => commandOfRule(r)))) {
      entries.push({ label: "ALLOW (project):", tone: "allow", what, where });
    }
    for (const what of new Set(edit.removed.map((r) => commandOfRule(r)))) {
      entries.push({ label: "REMOVE (project):", tone: "remove", what, where });
    }
  }
  return entries;
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
export function buildRemovalConfirmMessage(
  diff: InstallDiff,
  options: { editsSettings?: boolean } = {}
): string {
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
    return options.editsSettings === true
      ? "Some files recorded in the previous install will be removed. Proceed, and make these changes to your settings?"
      : "Some files recorded in the previous install will be removed. Proceed?";
  }
  return options.editsSettings === true
    ? `Remove Taskless from ${clauses.join(", ")}, and make these changes to your settings?`
    : `Remove Taskless from ${clauses.join(", ")}?`;
}
