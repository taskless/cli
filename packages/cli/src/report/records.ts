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
 * The one exception is a record that cannot be written at all, below.
 */

export const REPORTS_DIRECTORY = "reports";

export function reportsDirectory(cwd: string): string {
  return join(cwd, ".taskless", REPORTS_DIRECTORY);
}

/**
 * `YYYY-MM-DD_HHMMSS`, UTC, so records sort by when they were published. Two
 * publishes in one second share a stamp; `writeRecord` gives the later one a
 * `_2`, `_3`, … suffix, which sorts after the bare stamp (`_` follows `.`).
 */
export function recordStamp(now: Date): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replaceAll(":", "")}`;
}

/**
 * Names tried for one stamp before giving up. Within a second the order is not
 * publish order anyway (`now` is taken before the network call), so the
 * suffixes past `_9`, which sort before `_2`, cost nothing.
 */
const MAX_RECORD_NAMES = 100;

function recordName(stamp: string, attempt: number): string {
  return attempt === 1 ? `${stamp}.json` : `${stamp}_${String(attempt)}.json`;
}

/**
 * Write the record and return its file name.
 *
 * Called after the report is already live, holding the only credential that
 * can delete it, so failing here must never lose that credential. A name
 * already taken (two publishes in one second) moves to the next suffix, and
 * nothing is ever overwritten. Any other failure throws
 * `REPORT_RECORD_FAILED`, whose message and details carry the URL and the
 * delete URL: printing the credential is the lesser harm when the alternative
 * is a page nobody can take down.
 */
export async function writeRecord(
  cwd: string,
  published: PublishedReport,
  now: Date
): Promise<string> {
  const directory = reportsDirectory(cwd);
  const contents = `${JSON.stringify(
    {
      url: published.url,
      deleteUrl: published.deleteUrl,
      expiresAt: published.expiresAt,
    },
    null,
    2
  )}\n`;
  const stamp = recordStamp(now);
  let cause: unknown;
  try {
    await mkdir(directory, { recursive: true });
    for (let attempt = 1; attempt <= MAX_RECORD_NAMES; attempt += 1) {
      const name = recordName(stamp, attempt);
      try {
        await writeFile(join(directory, name), contents, {
          encoding: "utf8",
          flag: "wx",
        });
        return name;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    cause = new Error(
      `every record name for ${stamp} is taken (${String(MAX_RECORD_NAMES)} tried)`
    );
  } catch (error) {
    cause = error;
  }
  const reason = cause instanceof Error ? cause.message : String(cause);
  throw new CLIError(
    [
      `The report was published, but its record could not be written to ${directory} (${reason}).`,
      `The report is live at ${published.url} until ${published.expiresAt}.`,
      `This delete URL is the only way to take it down, so keep it somewhere private: ${published.deleteUrl}`,
      `To delete the report, send an HTTP DELETE to it, e.g. curl -X DELETE '${published.deleteUrl}'.`,
    ].join("\n"),
    "REPORT_RECORD_FAILED",
    {
      details: {
        url: published.url,
        deleteUrl: published.deleteUrl,
        expiresAt: published.expiresAt,
      },
    }
  );
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
