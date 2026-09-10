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
import type { InstallMode } from "../install/state";
import { getReloadNotice, versionMoved } from "../install/reload-notice";
import { getUpgradeTrailer } from "../install/upgrade-trailer";
import { readInstallState } from "../install/state";
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
import type { MigrationReport } from "../filesystem/migrate";
import { TASKLESS_DIRECTORY } from "../rules/vale/formats";
import { CLIError } from "../util/cli-error";
import { buildInvocation } from "../util/invocation";
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
    json: {
      type: "boolean",
      description:
        "Emit the install result as JSON, including what a migration moved",
      default: false,
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

    const result = await runNonInteractive(cwd, { json: args.json });
    if (args.json) {
      console.log(
        JSON.stringify({
          success: true,
          commandsInstalled: result.commandsInstalled,
          // `null` rather than absent when nothing was recorded, so a consumer
          // reads "fresh project" as a value and never has to probe for a key.
          cliVersion: {
            previous: result.previousCliVersion ?? null,
            installed: result.cliVersion,
          },
          // The per-target summary the human path prints. It used to go to
          // stderr under `--json` because nothing on the envelope carried it.
          targets: result.targets,
          // Derivable from `migrated` and `targets`, and included anyway: it
          // is the one value an agent gates its commit step on, and folding
          // four lists and a presence check is how a consumer gets it wrong.
          changed: result.changed,
          // Absent when nothing ran, so a caller distinguishes "the tree was
          // rewritten" from "nothing happened" by presence, never by reading
          // empty arrays out of it.
          ...(result.migrated === undefined
            ? {}
            : { migrated: result.migrated }),
        })
      );
    } else {
      if (result.reloadNotice !== undefined) {
        console.log(result.reloadNotice);
      }
      // Before the onboarding trailer, which stays the final line: several
      // scenarios pin it there, and an agent reads all of stdout anyway.
      const upgradeTrailer = getUpgradeTrailer({
        changedDirectories: result.targets
          .filter((target) => targetChanged(target))
          .map((target) => target.dir),
        migrated: result.migrated !== undefined,
        previousCliVersion: result.previousCliVersion,
        cliVersion: result.cliVersion,
        invocation: buildInvocation(),
      });
      if (upgradeTrailer !== undefined) {
        console.log(upgradeTrailer);
      }
      console.log(
        getOnboardTrailer({ commandsInstalled: result.commandsInstalled })
      );
    }
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

/** One install target's outcome, in the shape the `--json` envelope carries. */
interface TargetOutcome {
  dir: string;
  mode: InstallMode;
  writtenSkills: string[];
  writtenCommands: string[];
  removedSkills: string[];
  removedCommands: string[];
}

function targetChanged(target: TargetOutcome): boolean {
  return (
    target.writtenSkills.length > 0 ||
    target.writtenCommands.length > 0 ||
    target.removedSkills.length > 0 ||
    target.removedCommands.length > 0
  );
}

async function runNonInteractive(
  cwd: string,
  options: { json?: boolean } = {}
): Promise<{
  commandsInstalled: boolean;
  reloadNotice: string | undefined;
  migrated: MigrationReport | undefined;
  previousCliVersion: string | undefined;
  cliVersion: string;
  targets: TargetOutcome[];
  /** Whether a migration ran or any target wrote or removed anything. */
  changed: boolean;
}> {
  // Under `--json`, stdout carries only the envelope printed by the caller.
  // This per-target summary is not on that envelope (it is finer-grained than
  // `migrated`/`commandsInstalled`), so rather than drop it, it goes to
  // stderr — visible to a person watching the terminal, invisible to a
  // machine consumer parsing stdout.
  const log = options.json ? console.error : console.log;
  // Sampled BEFORE the directory is created, and that order is the whole
  // point. `ensureTasklessDirectory` mkdir -p's, so afterwards a pre-existing
  // project is indistinguishable from a fresh one.
  //
  // This path is also `init --no-interactive`, whose documented job is
  // refreshing an EXISTING project. Stamping there would mark a project that
  // never walked the ledger as fully reconciled and skip every entry, which is
  // the silent skip this feature exists to prevent.
  const wasNewProject = !(await pathExists(join(cwd, TASKLESS_DIRECTORY)));
  // `init` is now the ONLY command that migrates, so it is the only one that
  // can report what a migration moved. `check`, `verify` and `test` used to
  // carry this on their own envelopes and refuse rather than migrate now, so
  // the field followed the behaviour rather than being dropped.
  //
  // The migration notice is suppressed entirely under `--json`, rather than
  // moved to stderr like the per-target summary above: unlike that summary,
  // this information IS already on the envelope, as `migrated`, so printing
  // it a second time would just be noise. This is the actual `verify`/`test`
  // convention (`verify.ts`'s `onNotice: (message) => { if (!json)
  // console.error(message); }`), and the case `EnsureOptions.onNotice`'s own
  // doc comment describes: "callers that emit `--json` should pass a
  // callback that suppresses output under that flag: the same information is
  // on the envelope's `migrated` field". Omitting `onNotice` here, as before,
  // left it on the default fallback (unconditional `console.error`), which
  // never corrupts stdout but doesn't suppress the duplicate under `--json`
  // either — the gap a reviewer of this PR caught.
  const migrated = await ensureTasklessDirectory(cwd, {
    onNotice: (message: string) => {
      if (!options.json) console.error(message);
    },
  });
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

  // Read BEFORE applying: `applyInstallPlan` records the new version, so
  // afterwards there is nothing left to compare against.
  const previousState = await readInstallState(cwd);
  const previousCliVersion = previousState.cliVersion;
  const cliVersion = getCliVersion();
  const result = await applyInstallPlan(cwd, plan, { cliVersion });
  const reloadNotice = getReloadNotice({ previousCliVersion, cliVersion });

  if (detected.length === 0) {
    log(`No tools detected. Using fallback: ${DEFAULT_SHIM_DIR}/`);
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

  const targets: TargetOutcome[] = [];
  for (const target of plan.targets) {
    const writtenSkills = skillsByTarget.get(target.dir) ?? [];
    const writtenCommands = commandsByTarget.get(target.dir) ?? [];
    const removedSkills = removedSkillsByTarget.get(target.dir) ?? [];
    const removedCommands = removedCommandsByTarget.get(target.dir) ?? [];
    const noun = target.mode === "canonical" ? "canonical file" : "stub";
    const outcome: TargetOutcome = {
      dir: target.dir,
      mode: target.mode,
      writtenSkills,
      writtenCommands,
      removedSkills,
      removedCommands,
    };
    targets.push(outcome);

    if (!targetChanged(outcome)) {
      log(`${target.label} (${target.dir}/): up to date`);
      continue;
    }

    log(
      `${target.label} (${target.dir}/): wrote ${String(writtenSkills.length)} skill ${noun}(s)`
    );
    for (const name of writtenSkills) {
      log(`  - ${name}`);
    }
    if (writtenCommands.length > 0) {
      log(`  + ${String(writtenCommands.length)} command ${noun}(s)`);
    }
    if (removedSkills.length > 0) {
      log(`  removed ${String(removedSkills.length)} obsolete skill(s):`);
      for (const name of removedSkills) {
        log(`    - ${name}`);
      }
    }
    if (removedCommands.length > 0) {
      log(`  removed ${String(removedCommands.length)} obsolete command(s):`);
      for (const name of removedCommands) {
        log(`    - ${name}`);
      }
    }
  }

  return {
    commandsInstalled,
    reloadNotice,
    migrated,
    previousCliVersion,
    cliVersion,
    targets,
    // A version move rewrites `install.cliVersion` in the manifest, which is
    // a tracked file, so it is a change even when every skill byte matched.
    changed:
      migrated !== undefined ||
      targets.some((target) => targetChanged(target)) ||
      versionMoved({ previousCliVersion, cliVersion }),
  };
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
