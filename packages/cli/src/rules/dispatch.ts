import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { CheckResult } from "../types/check";
import {
  dedupeFindings,
  ENGINE_LAYOUTS,
  type AstGrepRuleSource,
  type EngineName,
} from "./engines";
import { executeRuntimeRules } from "./runtime/harness";
import type { RuntimeRule } from "./runtime/discover";
import { runAstGrepScan } from "./scan";
import { isValeFailure, runVale } from "./vale/run";

/**
 * Whether `.taskless/vale/rules/` holds anything to run.
 *
 * The spec is explicit that an empty rules directory means Vale is not invoked
 * at all. Worth an explicit check rather than letting Vale run and report
 * nothing: a scaffolded-but-empty engine directory is the common state after
 * `taskless init`, and spawning a subprocess per check to confirm it found
 * nothing is pure cost.
 */
export async function hasValeRules(cwd: string): Promise<boolean> {
  try {
    const entries = await readdir(
      join(cwd, ".taskless", ENGINE_LAYOUTS.vale.rulesDirectory)
    );
    return entries.some((entry) => entry.endsWith(".yml"));
  } catch {
    return false;
  }
}

/** One engine's contribution to a check. */
export interface EngineOutcome {
  engine: EngineName;
  results: CheckResult[];
  /**
   * Something the user should see that is not a finding — an engine that could
   * not run. Advisory: it does not affect the exit code.
   */
  notice?: string;
  /**
   * The engine was present and failed. Unlike a notice this must reach the exit
   * code, or a broken engine reads as a clean run.
   */
  failure?: string;
}

export interface DispatchOptions {
  cwd: string;
  /** Target paths, already filtered to those that exist. */
  paths: string[];
  /** ast-grep sources, each with the config that scans it. */
  astGrepSources: Array<{ source: AstGrepRuleSource; configPath: string }>;
  /** Runtime rules that survived planning. Empty means the harness is skipped. */
  runtimeRules: RuntimeRule[];
  runtimeTimeoutMs?: number;
  valeTimeoutMs?: number;
}

export interface DispatchResult {
  /** Every engine's findings, merged. */
  results: CheckResult[];
  /** Advisory messages: engines that could not run. */
  notices: string[];
  /** Failures that must fail the check even with no findings. */
  failures: string[];
  /** Per-engine detail, for callers that report engine by engine. */
  outcomes: EngineOutcome[];
}

/**
 * ast-grep over every source, deduped.
 *
 * `sg/rules/` and the legacy `.taskless/rules/` are scanned separately, so a
 * rule present in both reports twice; the finding is its own identity, so
 * identical matches collapse.
 */
async function runAstGrepEngine(
  options: DispatchOptions
): Promise<EngineOutcome> {
  const results: CheckResult[] = [];
  for (const { configPath } of options.astGrepSources) {
    const scan = await runAstGrepScan(options.cwd, options.paths, {
      configPath,
    });
    results.push(...scan.results);
  }
  return { engine: "sg", results: dedupeFindings(results) };
}

/**
 * Vale, when it has rules to run.
 *
 * The three non-ok outcomes divide along the line `isValeFailure` draws: an
 * absent binary is a notice, because an unsupported arch is an ordinary state
 * and failing there would make `check` unrunnable on a machine where the other
 * engines work; a timeout or a crash is a failure, because Vale was present and
 * asked to work, and reporting that as a skip lets a broken rule file read as
 * "no Vale findings".
 */
async function runValeEngine(options: DispatchOptions): Promise<EngineOutcome> {
  if (!(await hasValeRules(options.cwd))) {
    return { engine: "vale", results: [] };
  }

  const outcome = await runVale({
    cwd: options.cwd,
    paths: options.paths,
    timeoutMs: options.valeTimeoutMs,
  });

  if (outcome.status === "ok") {
    return { engine: "vale", results: outcome.results };
  }
  return isValeFailure(outcome)
    ? { engine: "vale", results: [], failure: outcome.message }
    : { engine: "vale", results: [], notice: outcome.message };
}

/** The runtime harness, over rules that planning already cleared to run. */
async function runRuntimeEngine(
  options: DispatchOptions
): Promise<EngineOutcome> {
  if (options.runtimeRules.length === 0) {
    return { engine: "runtime", results: [] };
  }
  const results = await executeRuntimeRules(options.cwd, options.runtimeRules, {
    paths: options.paths,
    timeoutMs: options.runtimeTimeoutMs,
  });
  return { engine: "runtime", results };
}

/**
 * Run every engine that has work, concurrently, and merge what they report.
 *
 * Concurrency is the point: the engines are independent subprocesses over the
 * same paths, and running them in sequence makes a check as slow as the sum of
 * its engines for no benefit.
 *
 * It also forces the isolation question. `allSettled`, not `all`: `all` rejects
 * on the first rejection and abandons the others, so one engine throwing would
 * discard results the rest had already produced — exactly the "an unavailable
 * engine must not abort the others" requirement, and the shape that makes it
 * true by construction rather than by everyone remembering to catch.
 *
 * A rejected engine becomes a failure rather than being swallowed. The engines
 * themselves report expected trouble as an outcome; a thrown error is something
 * unforeseen, and treating it as "no findings" would be the silent-disable
 * failure again.
 */
export async function runEngines(
  options: DispatchOptions
): Promise<DispatchResult> {
  const engines: Array<[EngineName, Promise<EngineOutcome>]> = [
    ["sg", runAstGrepEngine(options)],
    ["vale", runValeEngine(options)],
    ["runtime", runRuntimeEngine(options)],
  ];

  const settled = await Promise.allSettled(engines.map(([, task]) => task));

  const outcomes: EngineOutcome[] = settled.map((entry, index) => {
    const engine = engines[index]?.[0] ?? "sg";
    if (entry.status === "fulfilled") return entry.value;
    const reason: unknown = entry.reason;
    return {
      engine,
      results: [],
      failure: `${engine} engine failed: ${
        reason instanceof Error ? reason.message : String(reason)
      }`,
    };
  });

  return {
    results: outcomes.flatMap((outcome) => outcome.results),
    notices: outcomes
      .map((outcome) => outcome.notice)
      .filter((notice): notice is string => notice !== undefined),
    failures: outcomes
      .map((outcome) => outcome.failure)
      .filter((failure): failure is string => failure !== undefined),
    outcomes,
  };
}

/**
 * The exit code for a completed check.
 *
 * Two independent reasons to fail, and both are needed. An error-severity
 * finding is the ordinary one. An engine failure is the one that is easy to
 * miss: a Vale that timed out or rejected its config produces no findings, so
 * without this a broken engine exits 0 and reads exactly like a clean run.
 */
export function deriveExitCode(result: DispatchResult): number {
  const hasErrorFinding = result.results.some(
    (finding) => finding.severity === "error"
  );
  return hasErrorFinding || result.failures.length > 0 ? 1 : 0;
}
