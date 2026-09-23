import { readdir } from "node:fs/promises";
import type { CheckResult } from "../types/check";
import type { RefusedValeConfig, ValeAssembly } from "./assemble";
import { engineRulesDirectory } from "./engines";
import { type EngineName } from "./layout";
import { isMissingDirectory } from "./errno";
import { executeRuntimeRules } from "./runtime/harness";
import type { RuntimeRule } from "./runtime/discover";
import { runAstGrepScan } from "./scan";
import { runVale } from "./vale/run";
import { collectNotices } from "../util/notices";

/**
 * Whether `.taskless/rules/vale/` holds anything to run.
 *
 * The spec is explicit that an empty rules directory means Vale is not invoked
 * at all. Worth an explicit check rather than letting Vale run and report
 * nothing: a scaffolded-but-empty engine directory is the common state after
 * `taskless init`, and spawning a subprocess per check to confirm it found
 * nothing is pure cost.
 *
 * Only absence is swallowed. A blanket `catch` here would read an unreadable
 * rules directory (`EACCES`, a bad mount) as "no rules" and skip Vale with no
 * notice and no failure — the same silent-disable that `ValeRunOutcome`'s
 * `blocking` field exists to prevent one file over. Anything that is not
 * absence propagates, so `runEngines` reports it as an engine failure rather
 * than a clean run.
 */
export async function hasValeRules(cwd: string): Promise<boolean> {
  try {
    // A rule is a *directory* now, so this counts directories rather than
    // `*.yml` files. Looking for loose `.yml` here is how the whole engine
    // would read as "no rules configured" against a correctly laid-out
    // project — a silent skip, which is the failure this gate exists to make
    // impossible.
    const entries = await readdir(engineRulesDirectory(cwd, "vale"), {
      withFileTypes: true,
    });
    return entries.some((entry) => entry.isDirectory());
  } catch (error) {
    if (isMissingDirectory(error)) return false;
    throw error;
  }
}

/** One engine's contribution to a check. */
export interface EngineOutcome {
  engine: EngineName;
  results: CheckResult[];
  /**
   * Things the user should see that are not findings — an engine that could not
   * run, a config advisory. Advisory: they do not affect the exit code.
   *
   * A list rather than one joined string, so `runEngines` can concatenate every
   * engine's notices into a genuinely flat `DispatchResult.notices`. When this
   * was one `"\n"`-joined string, two advisories from one engine arrived as a
   * single array element, which `check --json` published with an embedded
   * newline and `check`'s text output rendered with only its first line
   * prefixed.
   */
  notices: string[];
  /**
   * The engine was present and failed. Unlike a notice this must reach the exit
   * code, or a broken engine reads as a clean run.
   */
  failure?: string;
}

export interface DispatchOptions {
  cwd: string;
  /**
   * Target paths, already filtered to those that exist.
   *
   * **Empty means "the whole project", and each engine is responsible for
   * expressing that in its own terms.** The engines do not agree on what an
   * empty target list means natively: ast-grep takes its targets from the
   * config and is content with none, while Vale given no input prints its usage
   * text and exits 0. Passing the empty list straight through therefore ran
   * ast-grep correctly and reduced Vale to a parse failure on every whole-
   * project check — findings silently absent, engine reported as broken.
   *
   * A new engine must decide what empty means for its own executor rather than
   * assuming the caller narrowed it.
   */
  paths: string[];
  /**
   * The assembled ast-grep `--config` path, or `undefined` when the project has
   * no ast-grep rules. One config, because assembly produced one — dispatch
   * runs it and does not know how it was built.
   */
  astGrepConfigPath: string | undefined;
  /**
   * Rule ids the ast-grep engine is restricted to — `check --rule`. Omitted is
   * the ordinary run and means every rule in the config.
   *
   * Vale needs no equivalent here: its narrowing happened at assembly, so what
   * arrives on `vale` is already the filtered config. Two engines, two
   * mechanisms, because ast-grep can be told which loaded rules may report and
   * Vale cannot.
   */
  astGrepRuleIds?: readonly string[];
  /**
   * What Vale assembly produced: the `--config` path with its advisories, a
   * refusal because a rule's config broke the schema, or `undefined` when
   * assembly produced nothing to run.
   *
   * Distinct from "the project has a Vale rules directory". A rule directory can
   * exist while every rule in it declares no config, and assembly then writes no
   * file and deletes none — so gating on the directory alone ran Vale against a
   * config left behind by a previous run, or against a path that was never
   * written. The config is the only honest signal that there is Vale work.
   *
   * A refusal arrives here rather than being resolved by the caller because it
   * is the Vale engine's failure: the engine was present, had rules to run,
   * and could not, which has to reach the exit code the same way a crash does.
   */
  vale: ValeAssembly | undefined;
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
  /**
   * The process exit code this run implies.
   *
   * Two independent reasons to fail, and both are needed. An error-severity
   * finding is the ordinary one. An engine failure is the one that is easy to
   * miss: a Vale that timed out or rejected its config produces no findings, so
   * without it a broken engine exits 0 and reads exactly like a clean run.
   *
   * Carried on the result rather than derived by each caller. It is a fact
   * about a completed dispatch, fixed the moment the engines settle, so
   * computing it once here removes the chance of two callers disagreeing about
   * what counts as failure.
   */
  exitCode: number;
}

/**
 * ast-grep over the assembled config.
 *
 * One scan, because there is one rule tree. The previous layout scanned the
 * engine directory and the legacy directory separately and deduplicated the
 * overlap; with a single tree there is no overlap to collapse.
 *
 * That also retires the concurrent-scan fix from the orchestration unit: the
 * `Promise.all` there existed to stop two config paths paying their latencies
 * in series, and a single tree leaves one path with nothing to overlap.
 */
async function runAstGrepEngine(
  options: DispatchOptions
): Promise<EngineOutcome> {
  if (options.astGrepConfigPath === undefined) {
    return { engine: "sg", results: [], notices: [] };
  }
  const scan = await runAstGrepScan(options.cwd, options.paths, {
    configPath: options.astGrepConfigPath,
    ...(options.astGrepRuleIds === undefined
      ? {}
      : { ruleIds: options.astGrepRuleIds }),
  });
  return { engine: "sg", results: scan.results, notices: [] };
}

/**
 * Vale, when it has rules to run.
 *
 * The three non-ok outcomes divide along the line `outcome.blocking` draws: an
 * absent binary is a notice, because an unsupported arch is an ordinary state
 * and failing there would make `check` unrunnable on a machine where the other
 * engines work; a timeout or a crash is a failure, because Vale was present and
 * asked to work, and reporting that as a skip lets a broken rule file read as
 * "no Vale findings". A refused assembly sits on the failure side for the same
 * reason, and is decided before the binary is even looked for.
 *
 * Reading the severity off the outcome rather than asking a helper is the point
 * of that field: an engine reports how bad its own trouble is, and a caller
 * cannot forget to ask. Every engine we add answers the same question the same
 * way.
 */
async function runValeEngine(options: DispatchOptions): Promise<EngineOutcome> {
  // Mirrors the ast-grep skip: no assembled config means assembly found no
  // work, and there is nothing to point Vale at. Checked before the directory
  // gate because it is the stronger claim — a rules directory can be present
  // while assembly yields nothing.
  if (options.vale === undefined) {
    return { engine: "vale", results: [], notices: [] };
  }
  // A refused assembly is a failure, not a notice, and not a quiet omission of
  // the offending rule. The config schema turned away a file Vale would have
  // read as something other than what its author wrote, so there is no config
  // to run. Leaving that rule out and running the rest would have it verify,
  // run, and report nothing, which is the silent disable this engine exists
  // to prevent; downgrading it to a notice would let a broken engine exit
  // zero. The rejection messages already name the rule and the line, so they
  // are carried as written rather than paraphrased.
  if (options.vale.status === "refused") {
    return {
      engine: "vale",
      results: [],
      notices: [],
      failure: describeValeRefusal(options.vale),
    };
  }
  if (!(await hasValeRules(options.cwd))) {
    return { engine: "vale", results: [], notices: [] };
  }

  const outcome = await runVale({
    cwd: options.cwd,
    paths: options.paths,
    configPath: options.vale.path,
    timeoutMs: options.valeTimeoutMs,
  });

  // What the schema said about the configs without refusing them travels with
  // whatever Vale itself has to say, both advisory.
  const advisories = options.vale.advisories;

  if (outcome.status === "ok") {
    // A zero-exit run that still wrote to stderr carries a diagnostic the
    // schema could not foresee: Vale's own warning about a style file, a
    // format, or a key a future Vale adds. It rides through as a notice and
    // never as a failure: the run succeeded, and letting it touch the exit
    // code would fail checks over a warning.
    return {
      engine: "vale",
      results: outcome.results,
      notices: collectNotices([...advisories, ...outcome.notices]),
    };
  }
  if (outcome.blocking) {
    // The failure is Vale's; the advisories are still the schema's, and they
    // are still advisory. They ride on `notice` beside the failure rather
    // than being folded into it (an advisory is not what failed the run) or
    // dropped (the config's authors would hear about a `[*]` matcher only on
    // a run where Vale happened not to crash).
    return {
      engine: "vale",
      results: [],
      failure: outcome.message,
      notices: collectNotices(advisories),
    };
  }
  return {
    engine: "vale",
    results: [],
    notices: collectNotices([...advisories, outcome.message]),
  };
}

/**
 * The Vale engine's failure message for a refused assembly.
 *
 * One message, because an outcome carries one `failure`, but every refused
 * rule and every rejection is in it: an author with two broken configs should
 * not fix one, re-run, and discover the other.
 */
function describeValeRefusal(refused: RefusedValeConfig): string {
  const rules = refused.refusals.map((refusal) => refusal.ruleId).join(", ");
  const lines = refused.refusals.flatMap((refusal) =>
    refusal.rejections.map((rejection) => rejection.message)
  );
  return [
    `Vale did not run: the config of ${rules} was rejected by the config schema. ` +
      `Run \`taskless verify\` for the constraint behind each line.`,
    ...lines,
  ].join("\n");
}

/** The runtime harness, over rules that planning already cleared to run. */
async function runRuntimeEngine(
  options: DispatchOptions
): Promise<EngineOutcome> {
  if (options.runtimeRules.length === 0) {
    return { engine: "runtime", results: [], notices: [] };
  }
  const results = await executeRuntimeRules(options.cwd, options.runtimeRules, {
    paths: options.paths,
    timeoutMs: options.runtimeTimeoutMs,
  });
  return { engine: "runtime", results, notices: [] };
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
      notices: [],
      failure: `${engine} engine failed: ${
        reason instanceof Error ? reason.message : String(reason)
      }`,
    };
  });

  const results = outcomes.flatMap((outcome) => outcome.results);
  const failures = outcomes.flatMap((outcome) => outcome.failure ?? []);

  return {
    results,
    notices: outcomes.flatMap((outcome) => outcome.notices),
    failures,
    outcomes,
    exitCode:
      results.some((finding) => finding.severity === "error") ||
      failures.length > 0
        ? 1
        : 0,
  };
}
