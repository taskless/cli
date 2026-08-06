import { resolve } from "node:path";

import {
  defineCommand,
  type CommandDef,
  type Resolvable,
  type SubCommandsDef,
} from "citty";

import { getTelemetry } from "../telemetry";
import { getRecipe } from "../prompts/recipes";

// Help-only recipe topics (no backing subcommand) that should still be
// discoverable from the `taskless help` index. The rule-authoring front
// door (`route`) and its destinations live here so an agent can find them.
const RECIPE_TOPICS: ReadonlyArray<[string, string]> = [
  ["route", "Decide where to author a rule (existing/static/remote)"],
  ["existing", "Author a rule in a linter the repo already uses"],
  ["static", "Author a local ast-grep rule on this machine (no login)"],
  ["remote", "Generate a rule via the Taskless service (login)"],
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

export function createHelpCommand(subCommands: SubCommandsDef) {
  return defineCommand({
    meta: {
      name: "help",
      description: "Show help for a command",
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
        if (argument !== "help") positionals.push(argument);
      }

      const cwd = resolve(args.dir);
      const telemetry = await getTelemetry(cwd);

      if (positionals.length === 0) {
        // cli_help with the index marker: agent fetched the topic list
        telemetry.capture("cli_help", { topic: "(index)" });

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
          if (name === "help") continue;
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
          "\nRun `taskless help <topic>` for the full recipe (e.g. `taskless help rule create`)."
        );
        return;
      }

      // Join positional args to form the lookup key
      const key = positionals.join("-");

      // Anonymous variant lookup: prefer <topic>.anonymous.txt when
      // --anonymous is set, fall back to the canonical recipe. The lookup and
      // the render both live in the shared prompts module, so `help` and the
      // `@taskless/cli/prompts` export emit the same text.
      const recipe = getRecipe(key, { anonymous: args.anonymous });

      if (recipe) {
        // cli_help: agent fetched a specific recipe (intent signal). The topic
        // is the served topic; filtering on it replaces the old per-topic events.
        telemetry.capture("cli_help", { topic: positionals.join(" ") });
        console.log(recipe.trimEnd());
      } else {
        // cli_help for an unknown topic — still the attempted topic string.
        telemetry.capture("cli_help", { topic: positionals.join(" ") });
        console.error(`Unknown command: ${positionals.join(" ")}`);
        console.error("Run `taskless help` for available commands.");
        process.exitCode = 1;
      }
    },
  });
}
