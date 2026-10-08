import { join, resolve } from "node:path";
import process from "node:process";

import { defineCommand } from "citty";

import { readManifest } from "../filesystem/manifest";
import { TASKLESS_DIRECTORY } from "../rules/vale/formats";
import { inputSchema, type FeedbackInput } from "../schemas/feedback";
import { writeNextAsk } from "../survey/cadence";
import {
  ANSWERED_INTERVAL_MS,
  RULE_SURVEY_ID,
  SURVEYS,
} from "../survey/constants";
import { getTelemetry, isTelemetryEnabled } from "../telemetry";
import { type CLIErrorCode, writeJsonError } from "../types/errors";
import { CLIError } from "../util/cli-error";
import { readJsonInput } from "../util/json-input";
import { getCliPrefix } from "../util/package-manager";

/**
 * What `dismiss` says under the telemetry opt-out. An agent should never reach
 * it in that state, because the invite is not served in it, so this is a
 * defensive line rather than a path the recipe describes. Exit zero: the user
 * asked for nothing to be sent, and nothing was.
 */
const NOTHING_SENT =
  "Telemetry is disabled, so no feedback was sent. Nothing else to do.";

/** Where to report instead when telemetry is off. */
export const ISSUES_URL = "https://github.com/taskless/cli/issues";

/**
 * What `send` says under the telemetry opt-out. Unlike the invite, general
 * feedback and bug reports are things the user asked to send, so the opt-out
 * gets a way forward rather than a shrug. Exit zero all the same: the opt-out
 * is honoured, not an error.
 */
const SEND_DISABLED = `Telemetry is disabled, so nothing was sent. To reach the Taskless team anyway, open an issue at ${ISSUES_URL}`;

/**
 * The bug survey's version-information answer, built by the CLI so the agent
 * can neither get it wrong nor leave it out.
 *
 * Local state only, and nothing that identifies the user: no login, email,
 * organization, repository URL, or path, and no network call. That rules out
 * reusing `info`, which probes `whoami` and reports all of those. The event
 * carries the usual telemetry identity regardless; this answer is the text a
 * person reads in the responses view, and it says only what build and project
 * layout the bug was seen on. A missing or unreadable `.taskless/` drops the
 * project lines rather than failing the report.
 */
export async function bugVersionInformation(cwd: string): Promise<string> {
  const manifest = await readManifest(join(cwd, TASKLESS_DIRECTORY)).then(
    (read) => read.manifest,
    () => null
  );
  const lines = [`cli: ${__VERSION__}`];
  const installed = manifest?.install?.cliVersion;
  if (installed) lines.push(`installed scaffold: ${installed}`);
  const reconciledTo = manifest?.rules?.reconciledTo;
  if (reconciledTo) lines.push(`rules reconciled to: ${reconciledTo}`);
  lines.push(
    `platform: ${process.platform} ${process.arch}`,
    `node: ${process.version}`
  );
  return lines.join("\n");
}

/**
 * The `survey sent` properties for a validated payload.
 *
 * Exactly PostHog's contract: `$survey_id` of the survey the payload's `kind`
 * selects, and one `$survey_response_<id>` per answered question. An optional
 * question left blank is absent rather than sent as an empty string, so the
 * responses view shows a gap and not an empty answer. A question with no
 * payload key is the CLI's to answer, from `cliAnswer`; the bug survey's
 * version information is the only one.
 */
export function buildSurveyResponse(
  input: FeedbackInput,
  cliAnswer?: string
): Record<string, string> {
  const survey = SURVEYS[input.kind];
  // The branches share no key type, so the payload is read as a plain record;
  // the schema has already decided which keys it may hold.
  const answers = input as Readonly<Record<string, string | undefined>>;
  const properties: Record<string, string> = { $survey_id: survey.id };
  for (const { key, id } of survey.questions) {
    const answer = key === undefined ? cliAnswer : answers[key];
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
    telemetry.capture("survey dismissed", { $survey_id: RULE_SURVEY_ID });
    await writeNextAsk(RULE_SURVEY_ID, Date.now() + ANSWERED_INTERVAL_MS);
    console.log("Thanks. Taskless will not ask again for a while.");
  },
});

const sendCommand = defineCommand({
  meta: {
    name: "send",
    description:
      "Send feedback, a bug report, or a rule survey response (use --from to specify the input file)",
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
        `--from is required. Provide a path to a JSON file.\n  Example: ${getCliPrefix()} feedback send --from .taskless/.tmp-feedback.json`,
        "INVALID_INPUT"
      );
    }

    let input: FeedbackInput;
    try {
      input = await readJsonInput(resolve(cwd, args.from), inputSchema);
    } catch (error) {
      fail(
        error instanceof Error ? error.message : String(error),
        "INVALID_INPUT"
      );
    }

    if (!isTelemetryEnabled()) {
      console.log(SEND_DISABLED);
      return;
    }

    const cliAnswer =
      input.kind === "bug" ? await bugVersionInformation(cwd) : undefined;
    const telemetry = await getTelemetry(cwd);
    telemetry.capture("survey sent", buildSurveyResponse(input, cliAnswer));
    // Only the invited survey has a cadence. General feedback and bug reports
    // are the user's own initiative, and answering one is not an answer to
    // the invite: it neither earns nor costs the user a quiet spell.
    if (input.kind === "rule") {
      await writeNextAsk(RULE_SURVEY_ID, Date.now() + ANSWERED_INTERVAL_MS);
    }
    // The input file is left where it is, like `rule create --from`; the
    // recipe's clean-up step deletes it, and `/.tmp-*` is ignored regardless.
    console.log("Feedback sent. Thank you.");
  },
});

/**
 * Three channels behind one command, chosen by the payload's `kind`: the
 * invited rule-authoring survey (`agent rule-feedback`, the only one with
 * `dismiss` and a cadence), general feedback (`agent feedback`), and bug
 * reports (`agent bug-report`). The command itself stays out of the
 * `taskless agent` index (see `UNLISTED_COMMANDS` there): the recipes are what
 * an agent should reach, because they show the user the payload first.
 */
export const feedbackCommand = defineCommand({
  meta: {
    name: "feedback",
    description:
      "Send Taskless feedback, a bug report, or the rule survey; or dismiss the survey",
  },
  subCommands: {
    dismiss: dismissCommand,
    send: sendCommand,
  },
});
