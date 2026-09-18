import { resolve } from "node:path";
import process from "node:process";

import { defineCommand } from "citty";

import { detectRepository } from "../detect/scan";
import { outputSchema as detectOutputSchema } from "../schemas/detect";
import { makeErrorEnvelope } from "../types/errors";

export const detectCommand = defineCommand({
  meta: {
    name: "detect",
    description:
      "Scan the repo for configured linters, languages, and existing rule styles (offline, deterministic)",
  },
  args: {
    dir: {
      type: "string",
      alias: "d",
      description: "Working directory",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    // detect is read-only with no state transition, so it emits no bespoke
    // event — the per-invocation cli_run denominator (emitted by the runner)
    // covers it, consistent with info under the cli_ telemetry taxonomy.

    const result = {
      success: true as const,
      ...(await detectRepository(cwd)),
    };

    if (args.json) {
      const parsed = detectOutputSchema.safeParse(result);
      if (!parsed.success) {
        console.log(
          JSON.stringify(
            makeErrorEnvelope(
              "INTERNAL_ERROR",
              "Internal schema validation failed"
            )
          )
        );
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(parsed.data));
      return;
    }

    // Human-readable output
    if (result.linters.length === 0) {
      console.log("Linters: none detected");
    } else {
      console.log("Linters:");
      for (const linter of result.linters) {
        console.log(`  ${linter.name}: ${linter.evidence.join(", ")}`);
      }
    }

    console.log(
      `\nLanguages: ${result.languages.length > 0 ? result.languages.join(", ") : "none detected"}`
    );

    if (result.ruleStyles.length > 0) {
      console.log("\nExisting rule styles:");
      for (const style of result.ruleStyles) {
        console.log(`  ${style.source}: ${style.description}`);
      }
    }
  },
});
