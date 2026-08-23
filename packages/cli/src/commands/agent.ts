import { resolve } from "node:path";

import {
  defineCommand,
  type CommandDef,
  type Resolvable,
  type SubCommandsDef,
} from "citty";

import { getTelemetry } from "../telemetry";
import { getRecipe } from "../prompts/recipes";
import {
  detectCliInvocation,
  processLauncherContext,
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
    },
    async run({ args, rawArgs }) {
      // Extract positional args from rawArgs, skipping flags and their values.
      // --dir/-d take a value; --json/--anonymous are boolean and do not.
      const valueFlagSet = new Set(["--dir", "-d"]);
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
        console.log(
          "For humans: run `npx @taskless/cli` (no args) to install or update Taskless,"
        );
        console.log("then ask your coding agent to do the work.\n");
        console.log("Topics:");

        const entries: Array<[string, string]> = [];
        for (const [name, cmd] of Object.entries(subCommands)) {
          if (name === "agent") continue;
          const description = await resolveDescription(cmd);
          entries.push([name, description]);
        }

        // Pad commands and recipe topics against a shared width so the two
        // sections line up.
        const maxLength = Math.max(
          ...entries.map(([name]) => name.length),
          ...RECIPE_TOPICS.map(([name]) => name.length)
        );
        for (const [name, description] of entries) {
          console.log(`  ${name.padEnd(maxLength + 2)}${description}`);
        }

        console.log("\nAuthoring recipes:");
        for (const [name, description] of RECIPE_TOPICS) {
          console.log(`  ${name.padEnd(maxLength + 2)}${description}`);
        }

        console.log(
          "\nAppend `--anonymous` to any rule/check command to skip the Taskless API"
        );
        console.log("and use local-only behavior.");
        console.log(
          "\nRun `taskless agent <topic>` for the full recipe (e.g. `taskless agent create-sg-rule`)."
        );
        return;
      }

      // Topics are addressed by exactly one token. Joining positionals into a
      // key used to make `rule create` resolve `rule-create.txt`, which invited
      // an agent to reorder or paraphrase a topic name and still get a hit.
      // A single hyphenated token is a literal string to copy, so extra
      // positionals are an error rather than something to guess at.
      if (positionals.length > 1) {
        telemetry.capture("cli_agent", { topic: positionals.join(" ") });
        console.error(`Too many arguments: ${positionals.join(" ")}`);
        console.error(
          "A topic is a single token. Run `taskless agent` for the topic index."
        );
        process.exitCode = 1;
        return;
      }

      const key = positionals[0]!;

      // Anonymous variant lookup: prefer <topic>.anonymous.txt when
      // --anonymous is set, fall back to the canonical recipe. The lookup and
      // the render both live in the shared prompts module, so `agent` and the
      // `@taskless/cli/prompts` export emit the same text.
      //
      // The invocation is detected HERE and passed in, never read inside the
      // prompts module: that module is imported by Workers without
      // `nodejs_compat`, where a module-scope `process` read throws at import
      // time. When the launcher is unknown the value is `undefined` and the
      // renderer falls back to its agent-fill marker.
      const recipe = getRecipe(key, {
        anonymous: args.anonymous,
        invocation: detectCliInvocation(processLauncherContext()),
      });

      if (recipe) {
        // cli_agent: agent fetched a specific recipe (intent signal). The topic
        // is the served topic; filtering on it replaces the old per-topic events.
        telemetry.capture("cli_agent", { topic: key });
        console.log(recipe.trimEnd());
      } else {
        // cli_agent for an unknown topic — still the attempted topic string.
        telemetry.capture("cli_agent", { topic: key });
        console.error(`Unknown command: ${key}`);
        console.error("Run `taskless agent` for available topics.");
        process.exitCode = 1;
      }
    },
  });
}
