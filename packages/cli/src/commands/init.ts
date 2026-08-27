import { join, resolve } from "node:path";
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
import {
  pathExists,
  recordReconciliation,
  reconciliationStart,
  stampNewProjectRules,
} from "../rules/reconcile-marker";
import { readManifest } from "../filesystem/migrate";
import { TASKLESS_DIRECTORY } from "../rules/vale/formats";
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
 * `taskless agent update` are the same thing. With `--rules` it stamps the
 * walk as complete.
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
    rules: {
      type: "boolean",
      description:
        "Stamp the rules as reconciled to this CLI, after completing the ledger walk",
      default: false,
    },
    json: {
      type: "boolean",
      description:
        "Output as JSON: the recipe plus where the walk starts, or the stamped result with --rules",
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

    // No `--rules`: this is the teaching path. Serve the SAME recipe
    // `agent update` serves, from the same renderer, so the two spellings
    // cannot drift into two different sets of instructions.
    if (!args.rules) {
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

      // `--json` is honoured here too. It used to be read only on the
      // recording path, so `taskless update --json` printed plain prose and
      // gave no sign the flag had done nothing.
      //
      // The payload also carries where the walk should START, computed by the
      // CLI rather than reasoned out of the recipe's prose. Same argument as
      // `route` reading `ghOwner` from `info` instead of shelling out to git:
      // two places deriving one answer can disagree, and the one that acts on
      // it should not be the one guessing.
      if (args.json) {
        const { manifest } = await readManifest(
          join(cwd, TASKLESS_DIRECTORY)
        ).catch(() => ({ manifest: undefined }));
        const walk = reconciliationStart(manifest?.rules?.reconciledTo);
        console.log(
          JSON.stringify({
            ok: true,
            topic: "update",
            reconciledTo: manifest?.rules?.reconciledTo ?? null,
            installed: getCliVersion(),
            // `null` when there is nothing to walk: either the project has
            // never recorded a reconciliation, which is not the same as being
            // behind, or it is already current.
            walk: walk ?? null,
            recipe,
          })
        );
        return;
      }

      console.log(recipe.trimEnd());
      return;
    }

    const telemetry = await getTelemetry(cwd);
    try {
      const result = await recordReconciliation(cwd);
      if (args.json) {
        console.log(JSON.stringify({ ok: true, ...result }));
      } else {
        console.log(
          result.previous === undefined
            ? `Rules reconciled to ${result.reconciledTo} (ast-grep ${result.engines.sg}, Vale ${result.engines.vale}).`
            : `Rules reconciled to ${result.reconciledTo}, was ${result.previous} (ast-grep ${result.engines.sg}, Vale ${result.engines.vale}).`
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
  // Sampled BEFORE the directory is created, and that order is the whole
  // point. `ensureTasklessDirectory` mkdir -p's, so afterwards a pre-existing
  // project is indistinguishable from a fresh one.
  //
  // This path is also `init --no-interactive`, whose documented job is
  // refreshing an EXISTING project. Stamping there would mark a project that
  // never walked the ledger as fully reconciled and skip every entry, which is
  // the silent skip this feature exists to prevent.
  const wasNewProject = !(await pathExists(join(cwd, TASKLESS_DIRECTORY)));
  await ensureTasklessDirectory(cwd);
  if (wasNewProject) {
    // A project this CLI just created has no entries to walk: everything the
    // ledger describes is already true of the scaffold it wrote.
    await stampNewProjectRules(cwd);
  }

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
