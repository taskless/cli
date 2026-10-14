import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { CLIError } from "../util/cli-error";
import type { PublishedReport } from "./publish";

/**
 * The local record of a published report: `.taskless/reports/<stamp>.json`.
 *
 * It holds the delete URL tskl.es returns exactly once, which is the only way
 * to take the page down before it expires. That is why the directory is
 * gitignored (migration 11) and why nothing here prints the delete URL: a
 * credential that reaches a terminal reaches scrollback, logs and screenshots.
 */

export const REPORTS_DIRECTORY = "reports";

export function reportsDirectory(cwd: string): string {
  return join(cwd, ".taskless", REPORTS_DIRECTORY);
}

/** `YYYY-MM-DD_HHMMSS`, UTC, so records sort by when they were published. */
export function recordStamp(now: Date): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replaceAll(":", "")}`;
}

/** Write the record and return its file name. */
export async function writeRecord(
  cwd: string,
  published: PublishedReport,
  now: Date
): Promise<string> {
  const directory = reportsDirectory(cwd);
  await mkdir(directory, { recursive: true });
  const name = `${recordStamp(now)}.json`;
  await writeFile(
    join(directory, name),
    `${JSON.stringify(
      {
        url: published.url,
        deleteUrl: published.deleteUrl,
        expiresAt: published.expiresAt,
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", flag: "wx" }
  );
  return name;
}

/**
 * A record named by file name, or by a path, absolute or relative to the
 * project, that lands directly in `.taskless/reports/`. Anything else is
 * refused: a successful delete removes the file, and `--delete` has no
 * business removing one outside the records directory.
 */
function recordPath(cwd: string, record: string): string {
  const directory = resolve(reportsDirectory(cwd));
  const path =
    record === basename(record)
      ? join(directory, record)
      : resolve(cwd, record);
  if (dirname(path) !== directory || !path.endsWith(".json")) {
    throw new CLIError(
      `${record} is not a report record. Name a file in .taskless/reports/, e.g. 2026-10-13_142200.json.`,
      "INVALID_INPUT"
    );
  }
  return path;
}

export async function readRecord(
  cwd: string,
  record: string
): Promise<{ path: string; published: PublishedReport }> {
  const path = recordPath(cwd, record);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new CLIError(
      `No report record at ${path}. Records live in .taskless/reports/.`,
      "REPORT_NOT_FOUND"
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CLIError(`${path} is not valid JSON.`, "INVALID_INPUT");
  }
  const value = parsed as Partial<PublishedReport> | null;
  if (typeof value?.deleteUrl !== "string" || typeof value.url !== "string") {
    throw new CLIError(
      `${path} has no delete URL, so the report cannot be deleted from here.`,
      "INVALID_INPUT"
    );
  }
  return {
    path,
    published: {
      url: value.url,
      deleteUrl: value.deleteUrl,
      expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : "",
    },
  };
}

export async function removeRecord(path: string): Promise<void> {
  await rm(path);
}
