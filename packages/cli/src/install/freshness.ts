import { access } from "node:fs/promises";
import { join } from "node:path";

import { readManifest } from "../filesystem/manifest";
import type { EnvironmentStep } from "../prompts/recipes";
import {
  getReconcileNotice,
  reconcileStatus,
  type ReconcileStatus,
} from "../rules/reconcile-status";
import { isCiEnvironment } from "../util/interactive";
import { compareSemver } from "../util/version-compare";
import { CLI_VERSION } from "../version";
import { checkCanonicalSkills } from "./install";
import { fetchLatestVersion } from "./latest-version";
import { buildLauncherPackage, type LauncherPackage } from "./launcher";

/**
 * Whether the Taskless environment is out of date, measured once and shared
 * by `agent ok` and `check` so the two cannot disagree.
 *
 * Three parts, each answered by the check that already owns it: a newer
 * published CLI (the npm registry), a skill that is not this CLI's (the same
 * comparison `info` reports), and rules owing a reconcile (the same status
 * `info` and `init` report). Everything here reads; nothing writes.
 */
export interface EnvironmentMeasurement {
  cli?: { packageName: LauncherPackage; running: string; latest: string };
  skill?: Array<{ name: string; installed?: string; current: string }>;
  rules?: ReconcileStatus;
}

export interface MeasureOptions {
  cwd: string;
  /** `process.env.CI`. In CI nothing is measured over the network. */
  ci?: string;
  /**
   * `process.env.NO_UPDATE_NOTIFIER`, the convention update-notifier and many
   * CLIs honour. Any non-empty value turns the registry lookup off.
   */
  noUpdateNotifier?: string;
  /** Injected for tests; the global `fetch` otherwise. */
  fetch?: typeof fetch;
  /** The running version; this build's own otherwise. */
  running?: string;
  /** The package this build is; `undefined` for a `self` build. */
  packageName?: LauncherPackage | null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function measureCli(
  options: MeasureOptions
): Promise<EnvironmentMeasurement["cli"]> {
  if (isCiEnvironment(options.ci)) return undefined;
  if (options.noUpdateNotifier !== undefined && options.noUpdateNotifier !== "")
    return undefined;
  const packageName =
    options.packageName === null
      ? undefined
      : (options.packageName ?? buildLauncherPackage());
  const running = options.running ?? CLI_VERSION;
  if (packageName === undefined || running === "unknown") return undefined;
  const latest = await fetchLatestVersion(packageName, {
    fetch: options.fetch,
  });
  if (latest === undefined || compareSemver(latest, running) <= 0) {
    return undefined;
  }
  return { packageName, running, latest };
}

/**
 * Measured from the canonical store directly, not per detected harness: the
 * version lives in `.taskless/` whatever harness reads it, and a project with
 * no harness detected still has a skill installed to `.agents/` (#644).
 */
async function measureSkill(
  cwd: string
): Promise<EnvironmentMeasurement["skill"]> {
  const skills = await checkCanonicalSkills(cwd);
  const stale = skills
    .filter((skill) => !skill.current)
    .map((skill) => ({
      name: skill.name,
      installed: skill.installedVersion,
      current: skill.currentVersion,
    }));
  return stale.length === 0 ? undefined : stale;
}

async function measureRules(
  directory: string,
  cwd: string
): Promise<EnvironmentMeasurement["rules"]> {
  try {
    const { manifest } = await readManifest(directory);
    const status = await reconcileStatus(cwd, manifest.rules);
    return status.required ? status : undefined;
  } catch {
    // An unreadable manifest is reported by the command that needs it, with
    // its own remedy. An advisory check has nothing useful to add.
    return undefined;
  }
}

export async function measureEnvironment(
  options: MeasureOptions
): Promise<EnvironmentMeasurement> {
  const directory = join(options.cwd, ".taskless");
  // Outside a `.taskless/` project there is no skill or rules state to judge.
  if (!(await exists(directory))) return { cli: await measureCli(options) };
  const [cli, skill, rules] = await Promise.all([
    measureCli(options),
    measureSkill(options.cwd),
    measureRules(directory, options.cwd),
  ]);
  return { cli, skill, rules };
}

/** What a person gets by leaving `init` off, which only works in a terminal. */
const INSTALLER_NOTE =
  "In a terminal, the same command without `init` opens the installer and its options.";

/**
 * The steps that bring the environment up to date, in the order they are to
 * be run: cli, skill, rules. `update` has to run with the CLI the project
 * keeps, so it comes after a CLI move.
 *
 * `invocation` spells the current CLI. `launcher` is the command word that
 * runs a package (`npx`, `pnpm dlx`), used for the newer CLI, which the
 * pinned invocation cannot reach.
 *
 * Both install steps name `init` rather than the bare invocation. A bare run
 * only installs from a terminal, through the wizard. Anywhere else it prints
 * the topic index and exits 0 having changed nothing.
 */
export function environmentSteps(
  measurement: EnvironmentMeasurement,
  spelling: { invocation: string; launcher: string }
): EnvironmentStep[] {
  const steps: EnvironmentStep[] = [];
  const { cli, skill, rules } = measurement;
  if (cli !== undefined) {
    steps.push({
      part: "cli",
      text:
        `A newer Taskless CLI is published: ${cli.packageName} ${cli.latest}, and this project runs ${cli.running}. ` +
        `Running \`init\` with the newer version moves the project to it and refreshes the installed skills. ${INSTALLER_NOTE}`,
      command: `${spelling.launcher} ${cli.packageName}@${cli.latest} init`,
    });
  }
  if (skill !== undefined) {
    const listed = skill
      .map(
        ({ name, installed, current }) =>
          `${name} ${installed ?? "(missing)"}, expected ${current}`
      )
      .join("; ");
    steps.push(
      cli === undefined
        ? {
            part: "skill",
            text:
              `The installed Taskless skill is not this CLI's (${listed}), so its instructions may not match the commands. ` +
              `Running \`init\` reinstalls it. ${INSTALLER_NOTE}`,
            command: `${spelling.invocation} init`,
          }
        : {
            part: "skill",
            text: `The installed Taskless skill is not this CLI's (${listed}). The newer CLI above refreshes it, so it needs no command of its own.`,
          }
    );
  }
  if (rules !== undefined) {
    const notice =
      getReconcileNotice(rules, spelling.invocation) ??
      "This project's rules are not reconciled to this CLI.";
    steps.push({
      part: "rules",
      text:
        cli === undefined
          ? notice
          : `${notice} After moving to the newer CLI, check again: it may owe a different reconcile.`,
      command: `${spelling.invocation} update`,
    });
  }
  return steps;
}

/**
 * The one notice `check` publishes when the environment is out of date, or
 * `undefined` when it is not.
 */
export function environmentNotice(
  steps: EnvironmentStep[]
): string | undefined {
  if (steps.length === 0) return undefined;
  // One line: a `--json` consumer reads `notices` one element per notice, and
  // text output marks it once. Steps are numbered inline instead.
  const parts = steps.map((step, index) => {
    const run = step.command === undefined ? "" : ` Run: ${step.command}`;
    return `(${String(index + 1)}) ${step.text}${run}`;
  });
  return `Your Taskless environment is out of date: ${parts.join(" ")}`;
}
