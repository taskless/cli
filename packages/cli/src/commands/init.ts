import { resolve } from "node:path";
import { defineCommand } from "citty";

import { ensureTasklessDirectory } from "../filesystem/directory";
import {
  applyInstallPlan,
  buildInstallPlan,
  DEFAULT_SHIM_DIR,
  detectSelectedDirectories,
  detectTools,
  getEmbeddedCommands,
  getEmbeddedSkills,
} from "../install/install";
import { getMandatorySkillNames } from "../install/catalog";
import { getTelemetry } from "../telemetry";
import { runWizard } from "../wizard";
import { getCliVersion } from "../wizard/intro";

import { getOnboardTrailer } from "./onboard";
import { getRecipe } from "../prompts/recipes";
import {
  detectCliInvocation,
  processLauncherContext,
} from "../util/package-manager";
import { recordReconciliation } from "../rules/reconcile-marker";
import { CLIError } from "../util/cli-error";
import { makeErrorEnvelope } from "../types/errors";

function shouldRunInteractively(noInteractiveFlag: boolean): boolean {
  if (noInteractiveFlag) return false;
  if (process.env.CI === "true" || process.env.CI === "1") return false;
  // Require both stdin and stdout to be TTYs — clack reads from stdin, so a
  // piped stdin (common in scripts) would hang the wizard even when stdout
  // is a TTY.
  return process.stdout.isTTY === true && process.stdin.isTTY === true;
}

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Install or update Taskless skills",
  },
  args: {
    dir: {
      type: "string",
      alias: "d",
      description: "Working directory",
    },
    "no-interactive": {
      type: "boolean",
      description:
        "Install every mandatory skill to every detected tool without prompting",
      default: false,
    },
    anonymous: {
      type: "boolean",
      description: "Accepted for compatibility; init has no auth dependency",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    const telemetry = await getTelemetry(cwd);

    const interactive = shouldRunInteractively(args["no-interactive"]);

    if (interactive) {
      const result = await runWizard({ cwd });
      if (result.status === "cancelled") {
        process.exitCode = 1;
      }
      return;
    }

    if (!args["no-interactive"] && process.stdout.isTTY !== true) {
      console.error(
        "Detected non-interactive context (no TTY); running non-interactive install."
      );
    }

    const result = await runNonInteractive(cwd);
    console.log(
      getOnboardTrailer({ commandsInstalled: result.commandsInstalled })
    );
    // Concrete state event: skills/commands were installed (non-interactive).
    telemetry.capture("cli_installed");
  },
});

/**
 * `update` is about the RULES, not about the installation.
 *
 * It used to mean "reinstall the skills non-interactively", which is what
 * `init --no-interactive` already does through the very same
 * `runNonInteractive`, and what the wizard does on any ordinary run. A second
 * name for that bought nothing, and it held a word that describes the job an
 * agent actually needs: deciding whether the rules in front of it need
 * rewriting after an engine or CLI upgrade.
 *
 * With no flags it serves the ledger recipe, so `taskless update` and
 * `taskless agent update` are the same thing. With `--reconciledTo` it records
 * that a walk completed.
 */
export const updateCommand = defineCommand({
  meta: {
    name: "update",
    description:
      "Learn what an upgrade changed for existing rules, or record a completed reconciliation",
  },
  args: {
    dir: {
      type: "string",
      alias: "d",
      description: "Working directory",
    },
    reconciledTo: {
      type: "string",
      description:
        "Record that the ledger walk completed up to this CLI version",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
    anonymous: {
      type: "boolean",
      description: "Accepted for compatibility; update has no auth dependency",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());

    // No `--reconciledTo`: this is the teaching path. Serve the SAME recipe
    // `agent update` serves, from the same renderer, so the two spellings
    // cannot drift into two different sets of instructions.
    if (args.reconciledTo === undefined) {
      const telemetry = await getTelemetry(cwd);
      const recipe = getRecipe("update", {
        anonymous: args.anonymous,
        invocation: detectCliInvocation(processLauncherContext()),
      });
      if (recipe === undefined) {
        console.error("No `update` recipe is bundled with this CLI.");
        process.exitCode = 1;
        return;
      }
      telemetry.capture("cli_agent", { topic: "update" });
      console.log(recipe.trimEnd());
      return;
    }

    const telemetry = await getTelemetry(cwd);
    try {
      const result = await recordReconciliation(cwd, args.reconciledTo);
      if (args.json) {
        console.log(JSON.stringify({ ok: true, ...result }));
      } else {
        console.log(
          result.previous === undefined
            ? `Recorded: rules reconciled to ${result.reconciledTo} (ast-grep ${result.engines.sg}, Vale ${result.engines.vale}).`
            : `Recorded: rules reconciled to ${result.reconciledTo}, was ${result.previous} (ast-grep ${result.engines.sg}, Vale ${result.engines.vale}).`
        );
      }
      telemetry.capture("cli_rules_reconciled");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error instanceof CLIError && error.code ? error.code : "INTERNAL_ERROR";
      if (args.json) {
        console.log(JSON.stringify(makeErrorEnvelope(code, message)));
      } else {
        console.error(message);
      }
      process.exitCode = 1;
    }
  },
});

async function runNonInteractive(
  cwd: string
): Promise<{ commandsInstalled: boolean }> {
  await ensureTasklessDirectory(cwd);

  const allSkills = getEmbeddedSkills();
  const mandatoryNames = new Set(getMandatorySkillNames());
  const skills = allSkills.filter((s) => mandatoryNames.has(s.name));
  const commands = getEmbeddedCommands();

  const detected = await detectTools(cwd);
  const selectedDirectories = await detectSelectedDirectories(cwd);
  const plan = buildInstallPlan(selectedDirectories, skills, commands);
  const commandsInstalled = plan.targets.some(
    (t) => t.mode === "reference" && t.commands.length > 0
  );

  const result = await applyInstallPlan(cwd, plan, {
    cliVersion: getCliVersion(),
  });

  if (detected.length === 0) {
    console.log(`No tools detected. Using fallback: ${DEFAULT_SHIM_DIR}/`);
  }

  const skillsByTarget = groupValuesByTarget(
    result.writtenSkills.map((entry) => ({
      target: entry.target,
      value: entry.skill,
    }))
  );
  const commandsByTarget = groupValuesByTarget(
    result.writtenCommands.map((entry) => ({
      target: entry.target,
      value: entry.command,
    }))
  );
  const removedSkillsByTarget = groupValuesByTarget(
    result.removedSkills.map((entry) => ({
      target: entry.target,
      value: entry.skill,
    }))
  );
  const removedCommandsByTarget = groupValuesByTarget(
    result.removedCommands.map((entry) => ({
      target: entry.target,
      value: entry.command,
    }))
  );

  for (const target of plan.targets) {
    const writtenSkills = skillsByTarget.get(target.dir) ?? [];
    const writtenCommands = commandsByTarget.get(target.dir) ?? [];
    const removedSkills = removedSkillsByTarget.get(target.dir) ?? [];
    const removedCommands = removedCommandsByTarget.get(target.dir) ?? [];
    const noun = target.mode === "canonical" ? "canonical file" : "stub";

    if (
      writtenSkills.length === 0 &&
      writtenCommands.length === 0 &&
      removedSkills.length === 0 &&
      removedCommands.length === 0
    ) {
      console.log(`${target.label} (${target.dir}/): up to date`);
      continue;
    }

    console.log(
      `${target.label} (${target.dir}/): wrote ${String(writtenSkills.length)} skill ${noun}(s)`
    );
    for (const name of writtenSkills) {
      console.log(`  - ${name}`);
    }
    if (writtenCommands.length > 0) {
      console.log(`  + ${String(writtenCommands.length)} command ${noun}(s)`);
    }
    if (removedSkills.length > 0) {
      console.log(
        `  removed ${String(removedSkills.length)} obsolete skill(s):`
      );
      for (const name of removedSkills) {
        console.log(`    - ${name}`);
      }
    }
    if (removedCommands.length > 0) {
      console.log(
        `  removed ${String(removedCommands.length)} obsolete command(s):`
      );
      for (const name of removedCommands) {
        console.log(`    - ${name}`);
      }
    }
  }

  return { commandsInstalled };
}

function groupValuesByTarget(
  entries: Array<{ target: string; value: string }>
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { target, value } of entries) {
    const list = map.get(target) ?? [];
    list.push(value);
    map.set(target, list);
  }
  return map;
}
