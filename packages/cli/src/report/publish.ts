import process from "node:process";

import { CLIError } from "../util/cli-error";
import { REPORT_MAX_BYTES, REPORT_PUBLISH_URL } from "./schema";
import type { ReportV1 } from "./types";

/**
 * The tskl.es client: publish, and delete.
 *
 * The retry contract is tskl.es's, from the schema's `x-taskless` block: retry
 * only `publish_failed` (502), which promises nothing was published, and never
 * after a timeout, which may still publish. A rate limit is surfaced rather
 * than retried, because the limit is per address and a loop only extends it.
 */

/** What tskl.es returns on a 201. */
export interface PublishedReport {
  url: string;
  deleteUrl: string;
  expiresAt: string;
}

/** Attempts on a 502, the first included. */
const MAX_ATTEMPTS = 3;

const TIMEOUT_MS = 30_000;

/** The publish endpoint, overridable so tests can stand up their own. */
function publishUrl(): string {
  return process.env.TASKLESS_REPORT_URL ?? REPORT_PUBLISH_URL;
}

function backoffMs(attempt: number): number {
  return process.env.TASKLESS_REPORT_BACKOFF_MS === undefined
    ? 1000 * attempt
    : Number(process.env.TASKLESS_REPORT_BACKOFF_MS);
}

/** The body as text, cut to something a terminal can show. */
async function bodyText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

/** Throws `REPORT_TOO_LARGE` when the body would exceed tskl.es's limit. */
export function encodeReport(report: ReportV1): string {
  const body = JSON.stringify(report);
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > REPORT_MAX_BYTES) {
    throw new CLIError(
      `The report is ${String(bytes)} bytes and tskl.es accepts at most ${String(REPORT_MAX_BYTES)}. Withhold long fixtures or drop cloud candidates, then retry.`,
      "REPORT_TOO_LARGE"
    );
  }
  return body;
}

function isPublished(value: unknown): value is PublishedReport {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.url === "string" &&
    typeof record.deleteUrl === "string" &&
    typeof record.expiresAt === "string"
  );
}

export async function publishReport(body: string): Promise<PublishedReport> {
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(publishUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // A timeout or a dropped connection: the request may have arrived, so
      // the report may exist. Retrying could publish it twice.
      const reason = error instanceof Error ? error.message : String(error);
      throw new CLIError(
        `Publishing did not complete (${reason}), and a report may have been published anyway. Re-running may create a duplicate; an unclaimed report expires on its own in 30 days.`,
        "REPORT_PUBLISH_UNKNOWN"
      );
    }

    if (response.status === 201) {
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      if (!isPublished(parsed)) {
        throw new CLIError(
          "tskl.es accepted the report but did not return its link and delete URL. Nothing was recorded.",
          "REPORT_PUBLISH_UNKNOWN"
        );
      }
      return parsed;
    }
    if (response.status === 502 && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
      continue;
    }
    if (response.status === 502) {
      throw new CLIError(
        `tskl.es could not store the report after ${String(MAX_ATTEMPTS)} attempts. Nothing was published; retry later.`,
        "REPORT_PUBLISH_FAILED"
      );
    }
    if (response.status === 429) {
      throw new CLIError(
        "tskl.es is rate limiting publishes from this address. Wait a minute, then retry.",
        "REPORT_RATE_LIMITED"
      );
    }
    if (response.status === 400 || response.status === 413) {
      throw new CLIError(
        `tskl.es refused the report: ${await bodyText(response)}`,
        "REPORT_INVALID"
      );
    }
    throw new CLIError(
      `tskl.es answered ${String(response.status)}: ${await bodyText(response)}`,
      "REPORT_PUBLISH_FAILED"
    );
  }
}

/** Delete a published report through the URL tskl.es returned for it. */
export async function deletePublishedReport(deleteUrl: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(deleteUrl, {
      method: "DELETE",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CLIError(
      `Could not reach tskl.es to delete the report: ${reason}`,
      "NETWORK_ERROR"
    );
  }
  if (!response.ok) {
    throw new CLIError(
      `tskl.es did not delete the report (${String(response.status)}): ${await bodyText(response)}`,
      "REPORT_DELETE_FAILED"
    );
  }
}
