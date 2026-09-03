import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { defineCommand } from "citty";

import { ensureTasklessDirectory } from "../filesystem/directory";
import { assessDelivery, writeDeliveredFileSet } from "../rules/deliver";
import { DEMO_RUNTIME_FILES, DEMO_RUNTIME_RULE_ID } from "../rules/demo/rule";
import { ruleDirectory } from "../rules/engines";
import { getCliPrefix } from "../util/package-manager";
import { CLIError } from "../util/cli-error";
import type { CLIErrorCode } from "../types/errors";

/** Report a failure the way the rule commands do, then stop. */
function fail(message: string, code: CLIErrorCode): never {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
  throw new CLIError(message, code, { reported: true });
}

/** Whether a path is present, with any stat failure read as absent. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const runtimeDemoCommand = defineCommand({
  meta: {
    name: "runtime",
    description:
      "Write an example runtime rule into this project, to run, read and delete",
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

    await ensureTasklessDirectory(cwd);

    const directory = ruleDirectory(cwd, "runtime", DEMO_RUNTIME_RULE_ID);

    // Refused rather than merged or overwritten. This is the one destructive
    // thing the command could do, and a demonstration is never worth doing it
    // to a rule someone has edited.
    if (await exists(directory)) {
      fail(
        `runtime/${DEMO_RUNTIME_RULE_ID} already exists in this project. ` +
          `Nothing was written. Remove it with ` +
          `\`${getCliPrefix()} rule delete ${DEMO_RUNTIME_RULE_ID}\` and run this again.`,
        "RULE_EXISTS"
      );
    }

    // Through the delivery path, not a second writer: the path-traversal and
    // completeness guards a served rule gets are the ones this rule wants too.
    const assessment = assessDelivery(
      cwd,
      "runtime",
      DEMO_RUNTIME_RULE_ID,
      DEMO_RUNTIME_FILES
    );
    if (!assessment.ok) {
      // Unreachable from shipped bytes; reported rather than asserted so a
      // future edit to the file list fails loudly instead of writing a
      // half-formed rule.
      fail(
        `The bundled demo rule was refused: ${assessment.reason}`,
        "INTERNAL_ERROR"
      );
    }
    await writeDeliveredFileSet(
      cwd,
      "runtime",
      DEMO_RUNTIME_RULE_ID,
      assessment
    );

    const prefix = getCliPrefix();
    console.log(`Wrote runtime/${DEMO_RUNTIME_RULE_ID}.`);
    console.log("");
    console.log(
      "It flags any `process.env` read whose key is not declared in the"
    );
    console.log(
      "repository-root `.env`. Deciding that needs both files at once, which is"
    );
    console.log("what makes it a runtime rule rather than a pattern.");
    console.log("");
    console.log("Run its fixtures:");
    console.log(`  ${prefix} test --dangerously-run-scripts`);
    console.log("");
    console.log(
      `\`${prefix} check\` will NOT run it. A runtime rule executes only when an`
    );
    console.log(
      "authenticated reconcile returns its signature, and this rule was written"
    );
    console.log(
      "locally rather than issued, so no run set contains it. That is the gate"
    );
    console.log("working, not a failure.");
    console.log("");
    console.log("Remove it:");
    console.log(`  ${prefix} rule delete ${DEMO_RUNTIME_RULE_ID}`);
  },
});

export const demoCommand = defineCommand({
  meta: {
    name: "demo",
    description: "Write an example rule into this project",
  },
  subCommands: {
    runtime: runtimeDemoCommand,
  },
});
