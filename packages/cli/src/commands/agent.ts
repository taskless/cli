import { resolve } from "node:path";
import process from "node:process";

import {
  defineCommand,
  type CommandDef,
  type Resolvable,
  type SubCommandsDef,
} from "citty";

import { getTelemetry } from "../telemetry";
import { detectHostTools } from "../detect/host-tools";
import { detectRepository } from "../detect/scan";
import { detectHarnessShell } from "../detect/harness-shell";
import { environmentSteps, measureEnvironment } from "../install/freshness";
import {
  ENVIRONMENT_VARIABLES,
  HOST_TOOL_VARIABLES,
  LINTER_VARIABLES,
  getRawRecipe,
  getServedRecipe,
  PACKAGE_MANAGER_DLX_MARKER,
  resolveInvocation,
  toolVariants,
} from "../prompts/recipes";
import { withSurveyInvite } from "../survey/invite";
import { applyCliInvocation } from "../util/invocation";
import {
  detectCliInvocation,
  detectLauncherCommand,
  getCliPrefix,
  processLauncherContext,
  projectLauncher,
} from "../util/package-manager";

// Recipe-only topics (no backing subcommand) that should still be
// discoverable from the `taskless agent` index. The rule-authoring front
// door (`route`) and its destinations live here so an agent can find them.
const RECIPE_TOPICS: ReadonlyArray<[string, string]> = [
  ["route", "Decide which recipe authors a rule (start here)"],
  ["create-legacy-rule", "Author a rule in a linter the repo already uses"],
  ["create-sg-rule", "Author a local ast-grep rule over code (no login)"],
  ["create-vale-rule", "Author a local Vale rule over prose (no login)"],
  ["create-runtime-rule", "The runtime tier, and why it needs an account"],
  ["create-remote-rule", "Generate a rule via the Taskless service (login)"],
];

/**
 * The feedback channels a user asks for, listed under their own heading:
 * neither is an authoring recipe, and `bug-report` is not a command. The
 * invited survey's `rule-feedback` is absent on purpose; see the note on
 * `feedback` in `UNLISTED_COMMANDS`.
 */
const FEEDBACK_TOPICS: ReadonlyArray<[string, string]> = [
  [
    "feedback",
    "Send the Taskless team feedback (user asks; no GitHub account)",
  ],
  ["bug-report", "Report a Taskless bug (user asks; no GitHub account)"],
];

/**
 * The preflight topic, listed under its own heading in the index. It is an
 * ordinary recipe (`agent/ok.md`) served through the same path as every other
 * topic, with two differences handled below: its body is the environment
 * report measured at fetch time, and it carries no fetch-time directive,
 * because the skill runs it once per session rather than once per task.
 *
 * Reaching it at all is the confirmation. A harness that refuses to run the
 * CLI refuses this first, before an agent has started any work. It reads
 * `.taskless/` to judge the environment and writes nothing there.
 */
const PREFLIGHT_TOPIC: [string, string] = [
  "ok",
  "Confirm you can run Taskless here (run once per session, first)",
];

async function unwrap<T>(resolvable: Resolvable<T>): Promise<T> {
  if (typeof resolvable === "function") {
    return (resolvable as () => T | Promise<T>)();
  }
  return resolvable;
}

async function resolveDescription(
  cmd: Resolvable<CommandDef>
): Promise<string> {
  const resolved = await unwrap(cmd);
  const meta = resolved.meta ? await unwrap(resolved.meta) : undefined;
  return meta?.description ?? "";
}

/**
 * Commands this index deliberately does not advertise.
 *
 * A declared list rather than a condition, because the entries are absent for
 * unrelated reasons and a bare `name === "agent"` recorded none of them.
 *
 * - `agent` is the index itself, so listing it would be circular.
 * - `feedback` the COMMAND is reached through a recipe, never directly. The
 *   index lists the `feedback` and `bug-report` recipes instead (see
 *   `FEEDBACK_TOPICS`), because they are what show the user the payload and
 *   wait for a yes; listing the command beside them would offer a path that
 *   skips the consent. The invited survey's `rule-feedback` recipe is listed
 *   nowhere: reached unprompted, it would put a `survey sent` with no invite
 *   behind it into the funnel.
 *
 * Absence from this list is what puts a command in the index, so adding one is
 * a decision someone made rather than a step they forgot.
 */
const UNLISTED_COMMANDS = new Set(["agent", "feedback"]);

/**
 * Names `--tool` refuses rather than falling back on. Each one is a linter
 * `detect` reports, so an agent could copy it into the flag, but none of them
 * hosts a legacy rule, and the generic recipe would tell it to try.
 * `anonymous` is here because it names the other variant file.
 */
const REFUSED_TOOLS = new Map<string, string>([
  ["ast-grep", "author an ast-grep rule with `agent create-sg-rule`."],
  ["vale", "author a Vale rule with `agent create-vale-rule`."],
  [
    "prettier",
    "it is a formatter and holds no rules; decide again with `agent route`.",
  ],
  [
    "black",
    "it is a formatter and holds no rules; decide again with `agent route`.",
  ],
  ["anonymous", "pass `--anonymous` for the local-only variant."],
]);

export function createAgentCommand(subCommands: SubCommandsDef) {
  return defineCommand({
    meta: {
      name: "agent",
      description: "Return a recipe for an AI coding agent to follow",
    },
    args: {
      dir: {
        type: "string",
        alias: "d",
        description: "Working directory",
        default: process.cwd(),
      },
      anonymous: {
        type: "boolean",
        description:
          "Return the local-only recipe variant when the topic has one",
        default: false,
      },
      tool: {
        type: "string",
        description:
          "Return the topic's variant for one tool, named as `detect` reports it",
      },
      section: {
        type: "string",
        description:
          "Return one section of the topic, named as its table of contents lists it. Not combined with --full",
      },
      full: {
        type: "boolean",
        description:
          "Return the whole topic, including the sections it serves on request. Not combined with --section",
        default: false,
      },
    },
    async run({ args, rawArgs }) {
      // Extract positional args from rawArgs, skipping flags and their values.
      // --dir/-d/--tool/--section take a value; --json/--anonymous/--full are
      // boolean and do not.
      const valueFlagSet = new Set(["--dir", "-d", "--tool", "--section"]);
      const positionals: string[] = [];
      for (let index = 0; index < rawArgs.length; index++) {
        const argument = rawArgs[index]!;
        if (argument.startsWith("-")) {
          if (!argument.includes("=") && valueFlagSet.has(argument)) index++;
          continue;
        }
        if (argument !== "agent") positionals.push(argument);
      }

      const cwd = resolve(args.dir);
      const telemetry = await getTelemetry(cwd);

      if (positionals.length === 0) {
        // cli_agent with the index marker: agent fetched the topic list.
        // The event was renamed from `cli_help` to match the command; the
        // rename is a hard cut with no dual-emit, so PostHog dashboards keyed
        // on the old name need updating.
        telemetry.capture("cli_agent", { topic: "(index)" });

        console.log("Taskless CLI\n");
        console.log(
          "For agents: this command returns recipes for an AI coding agent to follow."
        );
        // Routed through the build-target rewrite like every other emitted
        // invocation: a nightly telling a human to run `npx @taskless/cli`
        // sends them to install the release over the nightly they are running.
        console.log(
          applyCliInvocation(
            "For humans: run `npx @taskless/cli` (no args) to install or update Taskless,"
          )
        );
        console.log("then ask your coding agent to do the work.\n");

        const entries: Array<[string, string]> = [];
        for (const [name, cmd] of Object.entries(subCommands)) {
          if (UNLISTED_COMMANDS.has(name)) continue;
          const description = await resolveDescription(cmd);
          entries.push([name, description]);
        }

        // Pad the preflight, commands, and recipe topics against a shared
        // width so the sections line up.
        const maxLength = Math.max(
          PREFLIGHT_TOPIC[0].length,
          ...entries.map(([name]) => name.length),
          ...RECIPE_TOPICS.map(([name]) => name.length),
          ...FEEDBACK_TOPICS.map(([name]) => name.length)
        );
        const [preflightName, preflightDescription] = PREFLIGHT_TOPIC;
        console.log("Preflight:");
        console.log(
          `  ${preflightName.padEnd(maxLength + 2)}${preflightDescription}`
        );

        console.log("\nTopics:");
        for (const [name, description] of entries) {
          console.log(`  ${name.padEnd(maxLength + 2)}${description}`);
        }

        console.log("\nAuthoring recipes:");
        for (const [name, description] of RECIPE_TOPICS) {
          console.log(`  ${name.padEnd(maxLength + 2)}${description}`);
        }

        console.log("\nFeedback recipes:");
        for (const [name, description] of FEEDBACK_TOPICS) {
          console.log(`  ${name.padEnd(maxLength + 2)}${description}`);
        }

        console.log(
          "\nAppend `--anonymous` to any rule/check command to skip the Taskless API"
        );
        console.log("and use local-only behavior.");
        const prefix = getCliPrefix();
        console.log(
          `\nRun \`${prefix} agent <topic>\` for the recipe (e.g. \`${prefix} agent create-sg-rule\`).`
        );
        console.log(
          `A long recipe ends with the sections it serves on request; print one with \`${prefix} agent <topic> --section <name>\`.`
        );
        return;
      }

      // Topics are addressed by exactly one token. Joining positionals into a
      // key used to make `rule create` resolve `rule-create.md`, which invited
      // an agent to reorder or paraphrase a topic name and still get a hit.
      // A single hyphenated token is a literal string to copy, so extra
      // positionals are an error rather than something to guess at.
      if (positionals.length > 1) {
        telemetry.capture("cli_agent", { topic: positionals.join(" ") });
        console.error(`Too many arguments: ${positionals.join(" ")}`);
        console.error(
          `A topic is a single token. Run \`${getCliPrefix()} agent\` for the topic index.`
        );
        console.error(
          `To print one section of a topic, pass it as \`--section <name>\`.`
        );
        process.exitCode = 1;
        return;
      }

      // One section and the whole topic are different outputs; serving
      // either would quietly ignore half of what was asked.
      if (args.section !== undefined && args.full) {
        telemetry.capture("cli_agent", { topic: positionals[0] });
        console.error("--section and --full cannot be combined.");
        console.error(
          "Pass --section <name> for one section, or --full for the whole topic."
        );
        process.exitCode = 1;
        return;
      }

      const key = positionals[0]!;

      const tool = args.tool as string | undefined;
      // Refusal is a statement about a topic's tool variants, so it applies
      // only to a topic that has them. Elsewhere `--tool` selects nothing and
      // is ignored, and an unknown topic still reports itself as unknown
      // rather than hiding behind a "no legacy recipe" message.
      const refusal =
        tool === undefined || toolVariants(key).length === 0
          ? undefined
          : REFUSED_TOOLS.get(tool);
      if (refusal !== undefined) {
        telemetry.capture("cli_agent", { topic: key });
        console.error(`--tool=${tool} has no legacy recipe: ${refusal}`);
        process.exitCode = 1;
        return;
      }

      // Anonymous variant lookup: prefer <topic>.anonymous.md when
      // --anonymous is set, fall back to the canonical recipe. The lookup and
      // the render both live in the shared prompts module, so `agent` and the
      // `@taskless/cli/prompts` export emit the same text.
      //
      // The invocation is detected HERE and passed in, never read inside the
      // prompts module: that module is imported by Workers without
      // `nodejs_compat`, where a module-scope `process` read throws at import
      // time. When the launcher is unknown the value is `undefined` and the
      // renderer falls back to its agent-fill marker.
      const invocation = detectCliInvocation(processLauncherContext());
      // Host-tool detection is likewise a CLI-side read passed in, but unlike
      // the invocation it costs a `git` subprocess, so it runs only for the
      // topics whose template actually contains a conditioned passage. The
      // template is asked (`variables` comes from sprintf's own parse) rather
      // than a topic name being hardcoded, so the next recipe to use the
      // mechanism needs no edit here.
      const template = getRawRecipe(key, { anonymous: args.anonymous, tool });
      const hostTools = template?.variables.some((name) =>
        HOST_TOOL_VARIABLES.has(name)
      )
        ? await detectHostTools(cwd)
        : undefined;
      // The same question for the per-linter passage: a repository scan is
      // filesystem work, so only the topics that describe linters pay for it.
      const scan = template?.variables.some((name) =>
        LINTER_VARIABLES.has(name)
      )
        ? await detectRepository(cwd)
        : undefined;
      const linters = scan?.linters.map((linter) => linter.name);
      // The environment report: what is out of date, measured now. Only the
      // topics whose template asks for it pay for the registry lookup.
      const launcherContext = processLauncherContext();
      const environment = template?.variables.some((name) =>
        ENVIRONMENT_VARIABLES.has(name)
      )
        ? {
            steps: environmentSteps(
              await measureEnvironment({
                cwd,
                ci: process.env.CI,
                noUpdateNotifier: process.env.NO_UPDATE_NOTIFIER,
              }),
              {
                invocation: resolveInvocation({ invocation }),
                launcher:
                  detectLauncherCommand(launcherContext) ??
                  // A project launcher hides how the CLI was first installed,
                  // and npx is the spelling for moving to a new version.
                  (projectLauncher(launcherContext) === undefined
                    ? PACKAGE_MANAGER_DLX_MARKER
                    : "npx"),
              }
            ),
            shell: detectHarnessShell(process.env),
          }
        : undefined;
      const section = args.section as string | undefined;
      const served = getServedRecipe(
        key,
        {
          anonymous: args.anonymous,
          tool,
          invocation,
          hostTools,
          linters,
          environment,
          // What this command serves IS a fetch, so the served text says so:
          // resolved now, fetch again next task, and a session that installed
          // or upgraded mid-way holds a stale skill. The prompts export leaves
          // it off; see `RecipeOptions.directive`.
          // Except the preflight, which runs once per session.
          directive: key !== PREFLIGHT_TOPIC[0],
        },
        // A topic prints its outline unless asked for one section or the
        // whole text; see `src/prompts/sections.ts` (taskless/cli#672).
        section === undefined
          ? { kind: args.full ? "full" : "outline" }
          : { kind: "section", name: section }
      );

      if (served === undefined) {
        // cli_agent for an unknown topic — still the attempted topic string.
        telemetry.capture("cli_agent", { topic: key });
        console.error(`Unknown command: ${key}`);
        console.error(`Run \`${getCliPrefix()} agent\` for available topics.`);
        process.exitCode = 1;
      } else if (served.kind === "unknown-section") {
        telemetry.capture("cli_agent", { topic: key, section });
        console.error(`Unknown section for ${key}: ${served.name}`);
        console.error(`Sections: ${served.sections.join(", ")}`);
        process.exitCode = 1;
      } else if (section === undefined) {
        // cli_agent: agent fetched a specific recipe (intent signal). The topic
        // is the served topic; filtering on it replaces the old per-topic events.
        telemetry.capture("cli_agent", { topic: key });
        // A surveyed topic may carry the feedback invite after its last
        // section; the gate decides, and the render path above never sees it.
        console.log(
          await withSurveyInvite({
            recipe: served.text,
            topic: key,
            invocation,
            cwd,
            ci: process.env.CI,
          })
        );
      } else {
        // A section is a continuation of a topic already fetched, so it says
        // which one: a funnel reading `cli_agent` needs to tell a second look
        // at a topic from a fresh fetch of it. It never carries the feedback
        // invite, which belongs to the topic.
        telemetry.capture("cli_agent", { topic: key, section });
        console.log(served.text);
      }
    },
  });
}
