import { assembleEngineConfigs } from "./assemble";
import { runEngines, type DispatchResult } from "./dispatch";
import { planCheck, type CheckPlan } from "./plan-check";
import type { RuleSelection } from "./rule-filter";
import { openRun } from "./run-directory";
import { fromProjectRoot } from "./snapshot";

/**
 * The scan `check` performs, callable from any command.
 *
 * `check` and `report` both run this, so a report's counts are the counts
 * `check` would print for the same tree. Two scans that could drift apart are
 * how a published number stops matching the one a user can reproduce.
 */

export interface ScanOptions {
  /** Target paths, already filtered to those that exist; empty is the whole project. */
  paths: string[];
  anonymous: boolean;
  dangerouslyRunScripts: boolean;
  /** `check --rule`: narrows what runs, never widens it. */
  selection?: RuleSelection;
  runtimeTimeoutMs?: number;
  /** Keep the run directory under `.taskless/.run/` instead of removing it. */
  preserve?: boolean;
  /**
   * Called once the plan is made and before any engine runs, so a caller can
   * print the plan's notices ahead of the engines' own.
   */
  onPlan?: (plan: CheckPlan) => void;
}

export interface ScanResult {
  plan: CheckPlan;
  dispatched: DispatchResult;
  /** The run directory, relative to the project; only kept when `preserve` was set. */
  runDirectory: string;
}

export async function scanProject(
  cwd: string,
  options: ScanOptions
): Promise<ScanResult> {
  // This run's own directory under `.taskless/.run/`: the snapshot, the
  // assembled configs, and the logs. Removed when the run ends, however
  // it ends, unless `preserve` keeps it for debugging.
  const run = await openRun(cwd, { preserve: options.preserve ?? false });
  try {
    // Planned before dispatch, not during it: planning snapshots the rules
    // tree and consults auth and reconcile state, which decides WHAT runs.
    // Everything below reads the snapshot, never `.taskless/rules/`, so
    // the bytes that run are the bytes that were judged.
    const plan = await planCheck(cwd, run, {
      anonymous: options.anonymous,
      dangerouslyRunScripts: options.dangerouslyRunScripts,
    });
    options.onPlan?.(plan);

    const { selection } = options;
    // Assembled against the snapshot base, whose layout mirrors the
    // project's, so both configs resolve their rules inside the snapshot.
    // The engines still run from the project root; only the config path
    // is relative to it.
    const assembled = await assembleEngineConfigs(
      plan.snapshot.base,
      selection === undefined ? {} : { ruleIds: selection.vale }
    );
    const valeAssembly =
      assembled.vale?.status === "ok"
        ? {
            ...assembled.vale,
            path: fromProjectRoot(plan.snapshot, assembled.vale.path),
          }
        : assembled.vale;
    const sgConfig =
      assembled.sg === undefined
        ? undefined
        : fromProjectRoot(plan.snapshot, assembled.sg);
    // `--rule` narrows WHAT runs; it does not widen what may run. A runtime
    // rule named here is still subject to the plan.
    const runtimeExecute =
      selection === undefined
        ? plan.execute
        : plan.execute.filter((rule) => selection.runtime.includes(rule.name));
    const dispatched = await runEngines({
      cwd,
      paths: options.paths,
      // An `sg` selection that is empty means no ast-grep rule was named,
      // so the engine has nothing to do and is skipped rather than being
      // handed a filter that matches nothing — which would still spawn
      // ast-grep, load every rule, and walk the project to report none.
      astGrepConfigPath:
        selection !== undefined && selection.sg.length === 0
          ? undefined
          : sgConfig,
      ...(selection === undefined ? {} : { astGrepRuleIds: selection.sg }),
      vale: valeAssembly,
      runtimeRules: runtimeExecute,
      runtimeTimeoutMs: options.runtimeTimeoutMs,
      logs: run.logs,
    });
    return { plan, dispatched, runDirectory: run.relativePath };
  } finally {
    await run.close();
  }
}
