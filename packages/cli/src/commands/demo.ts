import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { defineCommand } from "citty";

import { ensureTasklessDirectory } from "../filesystem/directory";
import { assessDelivery, writeDeliveredFileSet } from "../rules/deliver";
import { type DemoRule, demoRuleFor } from "../rules/demo/rule";
import { ruleDirectory } from "../rules/engines";
import type { EngineName } from "../rules/layout";
import type { CLIErrorCode } from "../types/errors";
import { CLIError } from "../util/cli-error";
import { getCliPrefix } from "../util/package-manager";

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

/**
 * What each sample teaches, in the words the reader needs at the moment they
 * have the rule on disk and are deciding what to do with it.
 *
 * Held next to the command rather than in the rule's own `note`, because a
 * `note` is surfaced when a rule FIRES and this is guidance for someone who
 * has just written one.
 */
const SUMMARIES: Record<EngineName, string[]> = {
  sg: [
    "It flags `eval(...)` calls in TypeScript. The evidence is one expression",
    "in one file, and nothing else has to be read to decide it — which is what",
    "makes this an `sg` rule rather than a runtime one.",
  ],
  vale: [
    "It flags `utilize` in markdown and suggests `use`. Vale reads prose, so",
    "the rule is scoped to `**/*.md` and never looks at source.",
  ],
  runtime: [
    "It flags any `process.env` read whose key is not declared in the",
    "repository-root `.env`. Deciding that needs both files at once, which is",
    "what makes it a runtime rule rather than a pattern.",
  ],
};

/** Write one shipped demo rule into the project. */
async function writeDemoRule(cwd: string, rule: DemoRule): Promise<void> {
  await ensureTasklessDirectory(cwd);

  const directory = ruleDirectory(cwd, rule.engine, rule.ruleId);

  // Refused rather than merged or overwritten. This is the one destructive
  // thing the command could do, and a demonstration is never worth doing it to
  // a rule someone has edited.
  if (await exists(directory)) {
    fail(
      `${rule.engine}/${rule.ruleId} already exists in this project. ` +
        `Nothing was written. Remove it with ` +
        `\`${getCliPrefix()} rule delete ${rule.ruleId}\` and run this again.`,
      "RULE_EXISTS"
    );
  }

  // Through the delivery path, not a second writer: the path-traversal and
  // completeness guards a served rule gets are the ones these rules want too.
  const assessment = assessDelivery(cwd, rule.engine, rule.ruleId, rule.files);
  if (!assessment.ok) {
    // Unreachable from shipped bytes; reported rather than asserted so a future
    // edit to a manifest fails loudly instead of writing a half-formed rule.
    fail(
      `The bundled ${rule.engine} demo rule was refused: ${assessment.reason}`,
      "INTERNAL_ERROR"
    );
  }
  await writeDeliveredFileSet(cwd, rule.engine, rule.ruleId, assessment);

  const prefix = getCliPrefix();
  console.log(`Wrote ${rule.engine}/${rule.ruleId}.`);
  console.log("");
  for (const line of SUMMARIES[rule.engine]) console.log(line);
  console.log("");

  if (rule.engine === "runtime") {
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
  } else {
    console.log("Run its fixtures:");
    console.log(`  ${prefix} test`);
    console.log("");
    console.log(
      `\`${prefix} check\` runs it too: ${rule.engine} rules are inert data, so`
    );
    console.log("there is nothing to gate.");
  }

  console.log("");
  console.log("Remove it:");
  console.log(`  ${prefix} rule delete ${rule.ruleId}`);
}

/** One subcommand per engine, so `demo --help` lists what can be written. */
function engineDemoCommand(engine: EngineName, description: string) {
  return defineCommand({
    meta: { name: engine, description },
    args: {
      dir: { type: "string", alias: "d", description: "Working directory" },
    },
    async run({ args }) {
      const cwd = resolve(args.dir ?? process.cwd());
      const rule = demoRuleFor(engine);
      if (rule === undefined) {
        fail(`No demo rule ships for engine "${engine}"`, "INTERNAL_ERROR");
      }
      await writeDemoRule(cwd, rule);
    },
  });
}

export const demoCommand = defineCommand({
  meta: {
    name: "demo",
    description: "Write an example rule into this project",
  },
  subCommands: {
    sg: engineDemoCommand(
      "sg",
      "An ast-grep rule: one expression, one file, no execution"
    ),
    vale: engineDemoCommand("vale", "A Vale prose rule over markdown"),
    runtime: engineDemoCommand(
      "runtime",
      "A runtime rule whose evidence spans two files"
    ),
  },
});
