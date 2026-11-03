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
import { checkStaleness } from "./install";
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

async function measureSkill(
  cwd: string
): Promise<EnvironmentMeasurement["skill"]> {
  const harnesses = await checkStaleness(cwd);
  const stale = new Map<
    string,
    { name: string; installed?: string; current: string }
  >();
  for (const harness of harnesses) {
    for (const skill of harness.skills) {
      if (skill.current) continue;
      stale.set(skill.name, {
        name: skill.name,
        installed: skill.installedVersion,
        current: skill.currentVersion,
      });
    }
  }
  return stale.size === 0 ? undefined : [...stale.values()];
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

/**
 * The steps that bring the environment up to date, in the order they are to
 * be run: cli, skill, rules. `update` has to run with the CLI the project
 * keeps, so it comes after a CLI move.
 *
 * `invocation` spells the current CLI. `launcher` is the command word that
 * runs a package (`npx`, `pnpm dlx`), used for the newer CLI, which the
 * pinned invocation cannot reach.
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
        "Running the newer version with no arguments moves the project to it and refreshes the installed skills.",
      command: `${spelling.launcher} ${cli.packageName}@${cli.latest}`,
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
              "Running the CLI with no arguments reinstalls it.",
            command: spelling.invocation,
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
  const lines = ["Your Taskless environment is out of date:"];
  for (const step of steps) {
    lines.push(
      step.command === undefined
        ? `- ${step.text}`
        : `- ${step.text} Run: ${step.command}`
    );
  }
  return lines.join("\n");
}
