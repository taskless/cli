import { resolve } from "node:path";
import process from "node:process";

import { defineCommand } from "citty";

import { ensureTasklessDirectory } from "../filesystem/directory";
import { assembleReport } from "../report/assemble";
import { buildDraft } from "../report/draft";
import { reportFactsSchema } from "../schemas/report-facts";
import {
  deletePublishedReport,
  encodeReport,
  publishReport,
} from "../report/publish";
import { readRecord, removeRecord, writeRecord } from "../report/records";
import { reportSchemaIssues } from "../report/schema";
import { renderSummary } from "../report/summary";
import type { ReportV1 } from "../report/types";
import { getTelemetry } from "../telemetry";
import { writeJsonError, type CLIErrorCode } from "../types/errors";
import { CLIError } from "../util/cli-error";
import { readJsonInput } from "../util/json-input";
import { getCliPrefix } from "../util/package-manager";

/** Per-tier rule counts: what telemetry may know about a report. */
function tierCounts(report: ReportV1): Record<string, number> {
  const counts = { cli: 0, legacy: 0, cloud: 0 };
  for (const rule of report.rules) counts[rule.tier] += 1;
  return counts;
}

export const reportCommand = defineCommand({
  meta: {
    name: "report",
    description:
      "Draft, publish, or delete a Taskless report on tskl.es (an unlisted page showing what your rules catch)",
  },
  args: {
    dir: {
      type: "string",
      alias: "d",
      description: "Working directory",
    },
    from: {
      type: "string",
      description:
        "Publish: path to the facts JSON the agent wrote, e.g. .taskless/.tmp-report.json",
    },
    delete: {
      type: "string",
      description:
        "Delete a published report by its record in .taskless/reports/, e.g. 2026-10-13_142200.json",
    },
    json: {
      type: "boolean",
      description:
        "Print JSON: the publish result, or the { ok:false, code, message } envelope on error",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    const telemetry = await getTelemetry(cwd);

    /** Report a failure once, in the requested form, and stop. */
    function fail(error: CLIError): never {
      const code: CLIErrorCode = error.code ?? "INTERNAL_ERROR";
      if (args.json) {
        writeJsonError(code, error.message);
      } else {
        // The code is printed so a recipe can branch on it without `--json`.
        console.error(`Error (${code}): ${error.message}`);
      }
      telemetry.capture("cli_report_refused", { code });
      process.exitCode = 1;
      throw new CLIError(error.message, code, { reported: true });
    }

    async function guarded<T>(work: () => Promise<T>): Promise<T> {
      try {
        return await work();
      } catch (error) {
        if (error instanceof CLIError) fail(error);
        throw error;
      }
    }

    if (args.from !== undefined && args.delete !== undefined) {
      fail(
        new CLIError(
          "--from publishes and --delete deletes; pass one or the other.",
          "INVALID_INPUT"
        )
      );
    }

    await ensureTasklessDirectory(cwd, {
      onNotice: (message: string) => {
        if (!args.json) console.error(message);
      },
    });

    if (args.delete !== undefined) {
      const record = args.delete;
      await guarded(async () => {
        const { path, published } = await readRecord(cwd, record);
        // The record goes only once the service confirms: it holds the only
        // credential that can try again.
        await deletePublishedReport(published.deleteUrl);
        await removeRecord(path);
        telemetry.capture("cli_report_deleted");
        if (args.json) {
          console.log(JSON.stringify({ ok: true, deleted: published.url }));
        } else {
          console.log(`Deleted the report at ${published.url}.`);
        }
      });
      return;
    }

    if (args.from === undefined) {
      const draft = await buildDraft(cwd);
      telemetry.capture("cli_report_drafted", {
        rules: draft.rules.length,
      });
      console.log(JSON.stringify(draft, null, 2));
      return;
    }

    const factsPath = resolve(cwd, args.from);
    await guarded(async () => {
      let facts;
      try {
        facts = await readJsonInput(factsPath, reportFactsSchema);
      } catch (error) {
        throw new CLIError(
          error instanceof Error ? error.message : String(error),
          "REPORT_INVALID"
        );
      }

      const now = new Date();
      const report = assembleReport(await buildDraft(cwd), facts, now);

      const issues = reportSchemaIssues(report);
      if (issues.length > 0) {
        throw new CLIError(
          `The assembled report does not match the tskl.es schema:\n  ${issues.join("\n  ")}`,
          "REPORT_INVALID"
        );
      }
      const body = encodeReport(report);

      const published = await publishReport(body);
      const record = await writeRecord(cwd, published, now);
      telemetry.capture("cli_report_published", {
        ...tierCounts(report),
        withheldFixtures: report.redaction.withheldFixtures,
      });

      const summary = renderSummary({
        report,
        url: published.url,
        expiresAt: published.expiresAt,
        record,
        invocation: getCliPrefix(),
      });
      if (args.json) {
        console.log(
          JSON.stringify({
            ok: true,
            url: published.url,
            expiresAt: published.expiresAt,
            record: `.taskless/reports/${record}`,
            summary,
          })
        );
      } else {
        console.log(summary);
      }
    });
  },
});
