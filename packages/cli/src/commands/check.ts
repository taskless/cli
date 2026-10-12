import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { realpath, stat } from "node:fs/promises";
import process from "node:process";
import { defineCommand } from "citty";

import { hasValeRules, runEngines } from "../rules/dispatch";
import { assembleEngineConfigs } from "../rules/assemble";
import { splitRawArguments } from "../util/argv";
import { formatText } from "../util/format";
import { listRuleIds, planEngineDispatch } from "../rules/engines";
import { getTelemetry } from "../telemetry";
import { outputSchema as checkOutputSchema } from "../schemas/check";
import { makeErrorEnvelope, writeJsonError } from "../types/errors";
import { CLIError } from "../util/cli-error";
import { requireCurrentSchema } from "../filesystem/migrate";
import { discoverRuntimeRules } from "../rules/runtime/discover";
import { resolveRuleSelection, type RuleSelection } from "../rules/rule-filter";
import { planCheck } from "../rules/plan-check";
import { openRun } from "../rules/run-directory";
import { fromProjectRoot } from "../rules/snapshot";
import { markNotice } from "../util/notices";
import { getCliPrefix } from "../util/package-manager";

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/** `target` relative to `root`, or undefined when it lies outside `root`. */
function relativeInside(root: string, target: string): string | undefined {
  const relativePath = relative(root, target);
  const escapes =
    relativePath === ".." ||
    relativePath.startsWith(`..${"/"}`) ||
    relativePath.startsWith(`..${"\\"}`) ||
    isAbsolute(relativePath);
  return escapes ? undefined : relativePath;
}

/**
 * `absolutePath` with its nearest existing ancestor directory replaced by that
 * directory's real path.
 *
 * The ancestor rather than the path itself, for two reasons: a missing path
 * (a file deleted in the diff, even its whole directory) still has a real
 * spelling to compare, and a symlink inside the project pointing out of it is
 * judged by where it sits, not by where it leads, exactly as it was before.
 */
async function realParentSpelling(absolutePath: string): Promise<string> {
  let ancestor = dirname(absolutePath);
  const rest = [basename(absolutePath)];
  for (;;) {
    try {
      return join(await realpath(ancestor), ...rest);
    } catch {
      const parent = dirname(ancestor);
      if (parent === ancestor) return absolutePath;
      rest.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

interface ClassifiedPaths {
  /** In the project and on disk, relative to cwd so `sg scan` can use them. */
  kept: string[];
  /** In the project and not on disk, as the caller wrote them. */
  missing: string[];
  /** Outside the project, as the caller wrote them. */
  outside: string[];
}

/**
 * Sort each positional path into the three cases `check` answers differently.
 *
 * All three used to collapse into "drop it silently", so a path outside the
 * project, or one that does not exist, produced `success: true` with nothing
 * scanned and nothing said. That is a clean result for a check that did not
 * look, and a caller cannot tell it from a clean codebase (#475).
 *
 * Containment is decided from the path as written, before asking whether it
 * exists, so `/no/such/file.py` is reported as outside rather than as missing.
 * Both sides are compared as written AND through their real paths: on macOS
 * `/tmp` is `/private/tmp`, and `process.cwd()` returns the real spelling, so
 * a path handed over in either spelling must not read as escaping the project
 * while cwd is in the other.
 */
async function classifyPaths(
  cwd: string,
  rawPaths: string[]
): Promise<ClassifiedPaths> {
  const resolvedCwd = resolve(cwd);
  const roots = [resolvedCwd];
  try {
    const realCwd = await realpath(resolvedCwd);
    if (realCwd !== resolvedCwd) roots.push(realCwd);
  } catch {
    // cwd not existing is reported later by whatever reads the project.
  }

  const classified: ClassifiedPaths = { kept: [], missing: [], outside: [] };
  for (const rawPath of rawPaths) {
    const absolutePath = isAbsolute(rawPath)
      ? resolve(rawPath)
      : resolve(resolvedCwd, rawPath);
    const spellings = [absolutePath, await realParentSpelling(absolutePath)];
    const relativePath = roots
      .flatMap((root) =>
        spellings.map((spelling) => relativeInside(root, spelling))
      )
      .find((candidate) => candidate !== undefined);
    if (relativePath === undefined) {
      classified.outside.push(rawPath);
    } else if (await pathExists(absolutePath)) {
      classified.kept.push(relativePath === "" ? "." : relativePath);
    } else {
      classified.missing.push(rawPath);
    }
  }
  return classified;
}

/**
 * The notice for paths that were skipped because they do not exist.
 *
 * Skipped rather than refused: raw `git diff --name-only` output names
 * deleted files, and the CI recipe pipes it straight in, so a missing path is
 * an ordinary input. It is still named, so a mistyped path is visible.
 */
function missingPathsNotice(missing: string[]): string {
  const noun = missing.length === 1 ? "path that does" : "paths that do";
  return `Skipped ${missing.length} ${noun} not exist: ${missing.join(", ")}`;
}

/**
 * Extract positional path arguments from rawArgs. The shared scanner knows the
 * global value-taking flags and the POSIX `--` end-of-options marker (which is
 * what lets a path beginning with `-` be scanned); `--timeout` is check's own
 * value-taking flag, so it is named here rather than in the shared set.
 */
function extractPositionalPaths(rawArguments: string[]): string[] {
  return splitRawArguments(rawArguments, VALUE_FLAGS).positionals;
}

/**
 * `check`'s own value-taking flags, for the shared argv scanner.
 *
 * `--rule` has to be here or its value is scanned as a positional path:
 * `check --rule no-eval` would look for a file called `no-eval`, find none, and
 * take the "every supplied path was filtered out" branch — a clean exit 0 with
 * no findings, which is the same output a rule that fires nowhere produces.
 */
const VALUE_FLAGS = ["--timeout", "--rule"] as const;

/**
 * Every `--rule` value in argv, in the order given.
 *
 * Read from raw argv rather than from citty's parsed `args` because the flag is
 * REPEATABLE, and a parser that collapses a repeat to a single value turns
 * `--rule a --rule b` into a measurement of one rule while the author reads the
 * number as covering two. Both spellings are accepted (`--rule a` and
 * `--rule=a`), and scanning stops at `--` so a path literally named `--rule`
 * after the end-of-options marker is a path.
 *
 * Read through `splitRawArguments`, the same scanner {@link extractPositionalPaths}
 * uses, rather than a second scan of its own. A private scan would not know
 * which OTHER flags consume a token. For the malformed `check --timeout --rule
 * no-eval`, the shared scanner hands `--rule` to `--timeout` as its value and
 * `no-eval` to `positionals`; a `--rule`-only scan would instead read `--rule`
 * as a flag and claim `no-eval` as a rule id, so the same tokens would be both
 * a path and a rule id in one run. One pass cannot disagree with itself.
 */
export function extractRuleFilters(rawArguments: string[]): string[] {
  return splitRawArguments(rawArguments, VALUE_FLAGS)
    .values.filter((entry) => entry.flag === "--rule")
    .map((entry) => entry.value)
    .filter((id) => id !== "");
}

/** Parse `--timeout <seconds>` into milliseconds; invalid/absent → undefined (default). */
function parseTimeoutMs(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.round(seconds * 1000);
}

export const checkCommand = defineCommand({
  meta: {
    name: "check",
    description: "Run Taskless rules against your codebase",
  },
  args: {
    dir: {
      type: "string",
      alias: "d",
      description: "Working directory",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
    anonymous: {
      type: "boolean",
      description:
        "Run only trusted static rules; skip runtime rules (no reconciliation)",
      default: false,
    },
    "dangerously-run-scripts": {
      type: "boolean",
      description:
        "Run runtime-rule check.ts without server verification (executes untrusted code)",
      default: false,
    },
    timeout: {
      type: "string",
      description: "Per-runtime-check timeout in seconds (default 10)",
    },
    rule: {
      type: "string",
      description: "Run only the named rule; repeatable (--rule a --rule b)",
    },
    "preserve-logs": {
      type: "boolean",
      alias: "l",
      description:
        "Keep this run's directory under .taskless/.run/ (snapshot, configs, and engine logs) instead of removing it",
      default: false,
    },
  },
  async run({ args, rawArgs }) {
    const cwd = resolve(args.dir ?? process.cwd());
    const telemetry = await getTelemetry(cwd);

    // Warnings/notices are advisory human output; suppress them under --json so
    // the machine output stays the
    // { success, results, skipped?, failures?, notices? } shape. Engine
    // failures and notices are carried in that envelope instead, since a
    // machine consumer cannot read stderr prose.
    const warn = (message: string) => {
      if (!args.json) console.error(message);
    };

    /**
     * Print one notice, marking EVERY line of it.
     *
     * One marker per notice, and one per line within a notice that spans
     * lines. Both halves matter and both were missing somewhere. A notice can
     * be multi-line prose — Vale's stderr is passed through as written, and a
     * runtime repair notice embeds an `Error.message` it did not author — so
     * marking the first line alone leaves the rest reading as stray output
     * rather than as something the run is telling its author. That is the
     * defect `241e1c4` fixed for `validate`; `check` had it on the dispatched
     * notices, and printed the runtime plan's notices with no marker at all.
     *
     * Every notice `check` prints in text goes through here, so the three
     * sources cannot drift apart again: the `--json` `notices` array mixes
     * them, and text output that marked some and not others made the same
     * message look like two different kinds of thing depending on which list
     * it arrived on.
     */
    const warnNotice = (notice: string) => {
      for (const line of markNotice(notice, "Notice: ")) warn(line);
    };

    // Set when a scan actually runs; drives cli_check_completed with counts
    // only (never matched code).
    let scanCounts:
      | {
          errorCount: number;
          warningCount: number;
          findings: number;
          ruleCount: number;
        }
      | undefined;
    try {
      const positionalPaths = extractPositionalPaths(rawArgs);
      const hadExplicitPaths = positionalPaths.length > 0;
      const {
        kept: existingPaths,
        missing,
        outside,
      } = await classifyPaths(cwd, positionalPaths);

      // Refused, not skipped. `check` only scans inside the project, and a
      // path outside it is a caller pointing at the wrong place: reporting it
      // clean is the false negative #475 describes.
      if (outside.length > 0) {
        const message = `${outside.length === 1 ? "Path is" : "Paths are"} outside the project (${resolve(cwd)}): ${outside.join(", ")}. \`check\` only scans inside the project; run it from that project, or pass \`--dir\`.`;
        if (args.json) {
          writeJsonError("INVALID_INPUT", message);
        } else {
          console.error(`Error: ${message}`);
        }
        process.exitCode = 1;
        return;
      }

      const pathNotices =
        missing.length > 0 ? [missingPathsNotice(missing)] : [];

      // If the user passed paths but none exist (e.g. all-deleted diff),
      // exit cleanly with empty results rather than falling back to a full
      // scan, saying which paths were skipped.
      if (hadExplicitPaths && existingPaths.length === 0) {
        if (args.json) {
          console.log(
            JSON.stringify(
              checkOutputSchema.parse({
                success: true,
                results: [],
                ...(pathNotices.length > 0 ? { notices: pathNotices } : {}),
              })
            )
          );
        } else {
          for (const notice of pathNotices) warnNotice(notice);
        }
        return;
      }
      for (const notice of pathNotices) warnNotice(notice);

      // REFUSES rather than migrates. This used to call
      // `ensureTasklessDirectory`, so a command whose entire job is to report
      // rewrote the repository as a side effect: `0005` moves and deletes
      // tracked files, and the change landed in whatever commit came next. In
      // CI it ran on every checkout.
      //
      // It also made a migration unverifiable. Comparing findings before and
      // after is impossible when asking the question performs the change, so
      // a migration that silently dropped a rule could not be caught by the
      // one check that would catch it.
      try {
        await requireCurrentSchema(cwd);
      } catch (error) {
        // Handled here rather than left to the outer handler, which prints
        // prose: `--json` callers branch on the code, and this refusal asks
        // for a different response from a scan that blew up.
        if (error instanceof CLIError) {
          if (args.json) {
            // `requireCurrentSchema` always sets a code, so the fallback is
            // dead either way — which is exactly why the two call sites had
            // drifted to different dead values. One helper, one answer.
            writeJsonError(error.code ?? "INTERNAL_ERROR", error.message);
          } else {
            console.error(`Error: ${error.message}`);
          }
          process.exitCode = 1;
          return;
        }
        throw error;
      }
      // Resolved BEFORE the "no rules configured" gate, so a mistyped id is
      // reported as a mistyped id in every project rather than as "no rules
      // configured" in some of them. The refusal is handled here for the same
      // reason the scaffold refusal above is: it asks the caller to fix the
      // command line, not to read a failed scan.
      const requestedRules = extractRuleFilters(rawArgs);
      let mutableSelection: RuleSelection | undefined;
      if (requestedRules.length > 0) {
        try {
          mutableSelection = await resolveRuleSelection(cwd, requestedRules);
        } catch (error) {
          if (error instanceof CLIError) {
            if (args.json) {
              writeJsonError(error.code ?? "INVALID_INPUT", error.message);
            } else {
              console.error(`Error: ${error.message}`);
            }
            process.exitCode = 1;
            return;
          }
          throw error;
        }
      }

      // Rebound as a const so narrowing survives into the callbacks below: a
      // `let` is re-widened inside a closure, and the filter is read from one.
      const selection = mutableSelection;

      const dispatch = await planEngineDispatch(cwd);

      // Static rules (trusted ast-grep YAML) always run; runtime rules
      // (untrusted check.ts) are gated separately. Vale is discovered below,
      // in the "anything to run?" gate — every known engine now has an
      // executor, so none of them can be assumed to contribute nothing. A
      // directory that is not a known engine is still ignored rather than
      // handed to someone's parser.
      const astGrepRuleIds = await listRuleIds(cwd, "sg");
      // Both halves matter: `executor` alone is read from the static layout
      // table and is therefore always `runtime-harness`, so gating on it only
      // would make this unconditionally true and the presence check decorative.
      const runtimeDispatch = dispatch.find(
        (entry) => entry.engine === "runtime"
      );
      const runtimeEnabled =
        runtimeDispatch?.present === true &&
        runtimeDispatch.executor === "runtime-harness";
      const discoveredRuntimeRules = runtimeEnabled
        ? await discoverRuntimeRules(cwd)
        : [];
      // `--rule` narrows WHAT runs; it does not widen what may run. A runtime
      // rule named here is still subject to the signature gate, so an
      // unauthenticated `check --rule <runtime-rule>` reports the same skip it
      // would have reported inside a whole-project run.
      const runtimeRules =
        selection === undefined
          ? discoveredRuntimeRules
          : discoveredRuntimeRules.filter((rule) =>
              selection.runtime.includes(rule.name)
            );

      // "No rules configured" has to mean *no engine* has any, not just these
      // two: a project whose only rules live in `.taskless/rules/vale/` would
      // otherwise return here and Vale would never be dispatched, which is a
      // silent skip of the engine the user actually configured. Asked last and
      // short-circuited, so the ordinary project with ast-grep or runtime rules
      // pays nothing and `runEngines` still owns the decision to spawn Vale.
      const noRuleFiles =
        astGrepRuleIds.length === 0 &&
        runtimeRules.length === 0 &&
        !(await hasValeRules(cwd));

      if (noRuleFiles) {
        if (args.json) {
          console.log(
            JSON.stringify(
              checkOutputSchema.parse({
                success: true,
                results: [],
                ...(pathNotices.length > 0 ? { notices: pathNotices } : {}),
              })
            )
          );
        } else {
          console.log(
            `No rules configured. Create one with \`${getCliPrefix()} rule create --from <file>\`.`
          );
        }
        return;
      }

      // This run's own directory under `.taskless/.run/`: the snapshot, the
      // assembled configs, and the logs. Removed when the run ends, however
      // it ends, unless `--preserve-logs` keeps it for debugging.
      const preserve = Boolean(args["preserve-logs"]);
      const run = await openRun(cwd, { preserve });
      try {
        // Planned before dispatch, not during it: planning snapshots the rules
        // tree and consults auth and reconcile state, which decides WHAT runs.
        // Everything below reads the snapshot, never `.taskless/rules/`, so
        // the bytes that run are the bytes that were judged.
        const plan = await planCheck(cwd, run, {
          anonymous: args.anonymous,
          dangerouslyRunScripts: Boolean(args["dangerously-run-scripts"]),
        });
        for (const notice of plan.notices) warnNotice(notice);
        for (const failure of plan.failures) warn(`Error: ${failure}`);
        for (const skipped of plan.skipped) {
          warnNotice(
            `runtime rule ${skipped.rule} was not run — ${skipped.reason}.`
          );
        }

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
            : plan.execute.filter((rule) =>
                selection.runtime.includes(rule.name)
              );
        const dispatched = await runEngines({
          cwd,
          paths: existingPaths,
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
          runtimeTimeoutMs: parseTimeoutMs(args.timeout),
          logs: run.logs,
        });
        const results = dispatched.results;

        for (const notice of dispatched.notices) warnNotice(notice);
        const runNotices = [
          ...pathNotices,
          ...plan.notices,
          ...dispatched.notices,
        ];
        for (const failure of dispatched.failures) warn(`Error: ${failure}`);

        let errorCount = 0;
        let warningCount = 0;
        for (const result of results) {
          if (result.severity === "error") errorCount++;
          else if (result.severity === "warning") warningCount++;
        }
        // `ruleCount` is how many rules the scan LOADED, across all three
        // engines. Without it a scan with no findings and a scan with no rules
        // are the same event, which is exactly the pair the metrics need to
        // tell apart. Runtime rules the plan skipped still count: the question
        // is how many rules this workspace has configured, not how many
        // executed on this run.
        //
        // `listRuleIds` swallows its own read errors and returns `[]`, so this
        // cannot turn an unreadable directory into a failed scan. A telemetry
        // count must never be the thing that fails a command.
        const valeRuleIds = await listRuleIds(cwd, "vale");
        scanCounts = {
          errorCount,
          warningCount,
          findings: results.length,
          ruleCount:
            astGrepRuleIds.length +
            valeRuleIds.length +
            // Discovered, not the `--rule` subset: the question this count
            // answers is how many rules the workspace has configured, and the
            // other two terms are unfiltered for the same reason.
            discoveredRuntimeRules.length,
        };

        // Computed by `runEngines`, not here: the exit code is a fact about a
        // completed dispatch, and an engine failure has to fail the check even
        // with no findings.
        //
        // With one exception decided here: a runtime rule the service withheld
        // for the plan fails the run whatever the scan found. Every other skip
        // leaves the exit code alone because the CLI could not ask; this one
        // is the answer to asking, and a green run would say the rule is still
        // protecting the repository when it has stopped running.
        //
        // The plan's failures are the same kind of answer: an edited ast-grep
        // or Vale rule, a rule the service's answer did not account for, or
        // ids that collide across engines. Each is a verified outcome, never a
        // degrade path, and a green run would say the rule is protecting the
        // repository when it did not run.
        const withheldForPlan = (plan.entitlement?.withheld.length ?? 0) > 0;
        const exitCode =
          dispatched.exitCode === 0 &&
          (withheldForPlan || plan.failures.length > 0)
            ? 1
            : dispatched.exitCode;
        const allFailures = [...plan.failures, ...dispatched.failures];

        if (args.json) {
          const output = checkOutputSchema.parse({
            success: exitCode === 0,
            results,
            ...(plan.skipped.length > 0 ? { skipped: plan.skipped } : {}),
            ...(allFailures.length > 0 ? { failures: allFailures } : {}),
            // BOTH sources. `plan.notices` carries the repair diagnostics —
            // what was restored, what could not be, and why — and they used to
            // reach only `warn()`, which is a no-op under `--json`. So the one
            // channel a CI run reads dropped the entire output of the feature
            // whose whole purpose is explaining a rule that did not run.
            ...(runNotices.length > 0 ? { notices: runNotices } : {}),
            ...(plan.entitlement === undefined
              ? {}
              : { entitlement: plan.entitlement }),
            ...(plan.integrity.length > 0 ? { integrity: plan.integrity } : {}),
            ...(preserve ? { runDirectory: run.relativePath } : {}),
          });
          console.log(JSON.stringify(output));
        } else {
          console.log(formatText(results));
          if (preserve) {
            console.error(`Run directory kept: ${run.relativePath}`);
          }
        }

        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      } catch (error) {
        const message = `Error: ${error instanceof Error ? error.message : String(error)}`;
        // A `CLIError` already carries the code an agent branches on, and
        // flattening every failure to `SCAN_FAILED` threw it away. The scaffold
        // refusal is the case that made this visible: "migrate your project" and
        // "the scan blew up" want different responses and were arriving as the
        // same one.
        const code =
          error instanceof CLIError
            ? (error.code ?? "SCAN_FAILED")
            : "SCAN_FAILED";
        if (args.json) {
          console.log(JSON.stringify(makeErrorEnvelope(code, message)));
        } else {
          console.error(message);
        }
        process.exitCode = 1;
      } finally {
        await run.close();
      }
    } finally {
      // Concrete state event: a scan completed; counts only, no matched code.
      if (scanCounts) {
        telemetry.capture("cli_check_completed", scanCounts);
      }
    }
  },
});
