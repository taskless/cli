import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { defineCommand } from "citty";
import { ZodError } from "zod";

import { inputSchema, type FeedbackInput } from "../schemas/feedback";
import { writeNextAsk } from "../survey/cadence";
import {
  ANSWERED_INTERVAL_MS,
  SURVEY_ID,
  SURVEY_QUESTIONS,
} from "../survey/constants";
import { getTelemetry, isTelemetryEnabled } from "../telemetry";
import { type CLIErrorCode, writeJsonError } from "../types/errors";
import { CLIError } from "../util/cli-error";

/**
 * What both verbs say under the telemetry opt-out. An agent should never
 * reach them in that state, because the invite is not served in it, so this
 * is a defensive line rather than a path the recipe describes. Exit zero: the
 * user asked for nothing to be sent, and nothing was.
 */
const NOTHING_SENT =
  "Telemetry is disabled, so no feedback was sent. Nothing else to do.";

/**
 * The `survey sent` properties for a validated payload.
 *
 * Exactly PostHog's contract: `$survey_id` and one `$survey_response_<id>`
 * per answered question. An optional question left blank is absent rather
 * than sent as an empty string, so the responses view shows a gap and not an
 * empty answer.
 */
export function buildSurveyResponse(
  input: FeedbackInput
): Record<string, string> {
  const properties: Record<string, string> = { $survey_id: SURVEY_ID };
  for (const { key, id } of SURVEY_QUESTIONS) {
    const answer = input[key];
    if (answer !== undefined) properties[`$survey_response_${id}`] = answer;
  }
  return properties;
}

const dismissCommand = defineCommand({
  meta: {
    name: "dismiss",
    description: "Record that the user declined the feedback survey",
  },
  args: {
    dir: {
      type: "string",
      alias: "d",
      description: "Working directory",
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    if (!isTelemetryEnabled()) {
      console.log(NOTHING_SENT);
      return;
    }
    const telemetry = await getTelemetry(cwd);
    telemetry.capture("survey dismissed", { $survey_id: SURVEY_ID });
    await writeNextAsk(SURVEY_ID, Date.now() + ANSWERED_INTERVAL_MS);
    console.log("Thanks. Taskless will not ask again for a while.");
  },
});

const sendCommand = defineCommand({
  meta: {
    name: "send",
    description:
      "Send a completed feedback survey (use --from to specify the input file)",
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
        "Path to a JSON file containing the feedback payload (required). Example: --from .taskless/.tmp-feedback.json",
    },
    json: {
      type: "boolean",
      description:
        "On error, write the standardized { ok:false, code, message } envelope to stdout instead of human text on stderr",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());

    /** Emit an error and exit, respecting --json mode */
    function fail(message: string, code: CLIErrorCode): never {
      if (args.json) {
        writeJsonError(code, message);
      } else {
        console.error(`Error: ${message}`);
      }
      process.exitCode = 1;
      throw new CLIError(message, code, { reported: true });
    }

    // Validate before checking the opt-out: a malformed payload is wrong
    // whether or not anything would be sent, and the agent should hear so.
    if (!args.from) {
      fail(
        "--from is required. Provide a path to a JSON file.\n  Example: taskless feedback send --from .taskless/.tmp-feedback.json",
        "INVALID_INPUT"
      );
    }

    const filePath = resolve(cwd, args.from);
    let fileContent: string;
    try {
      fileContent = await readFile(filePath, "utf8");
    } catch {
      fail(`Could not read file "${args.from}".`, "INVALID_INPUT");
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(fileContent) as unknown;
    } catch {
      fail(`"${args.from}" is not valid JSON.`, "INVALID_INPUT");
    }

    let input: FeedbackInput;
    try {
      input = inputSchema.parse(rawJson);
    } catch (error) {
      if (error instanceof ZodError) {
        fail(
          `Invalid input: ${error.issues
            .map(
              (issue) =>
                `${issue.path.join(".") || "payload"}: ${issue.message}`
            )
            .join(", ")}`,
          "INVALID_INPUT"
        );
      }
      fail(
        error instanceof Error ? error.message : String(error),
        "INVALID_INPUT"
      );
    }

    if (!isTelemetryEnabled()) {
      console.log(NOTHING_SENT);
      return;
    }

    const telemetry = await getTelemetry(cwd);
    telemetry.capture("survey sent", buildSurveyResponse(input));
    await writeNextAsk(SURVEY_ID, Date.now() + ANSWERED_INTERVAL_MS);
    // The input file is left where it is, like `rule create --from`; the
    // recipe's clean-up step deletes it, and `/.tmp-*` is ignored regardless.
    console.log("Feedback sent. Thank you.");
  },
});

/**
 * Reached only through the survey invite. Deliberately absent from the
 * `taskless agent` index (see `UNLISTED_COMMANDS` there): listing it would
 * invite an agent to run it unprompted. When a general feedback channel
 * exists, this surface folds into it.
 */
export const feedbackCommand = defineCommand({
  meta: {
    name: "feedback",
    description: "Send or dismiss the Taskless feedback survey",
  },
  subCommands: {
    dismiss: dismissCommand,
    send: sendCommand,
  },
});
