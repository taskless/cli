import { resolve, isAbsolute, relative } from "node:path";
import { stat } from "node:fs/promises";
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
// The gate lives beside the runtime engine rather than inside this command,
// because `test` runs a rule's fixtures under exactly this policy. Sharing the
// implementation is what makes that a fact rather than an intention.
import { planRuntime } from "../rules/runtime/plan";
import { markNotice } from "../util/notices";

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve each positional path against cwd and filter out any that don't
 * exist on disk. Returns a list of paths relative to cwd so `sg scan` can
 * be spawned from cwd and use those paths directly.
 */
async function filterExistingPaths(
  cwd: string,
  rawPaths: string[]
): Promise<string[]> {
  const resolvedCwd = resolve(cwd);
  const kept: string[] = [];
  for (const rawPath of rawPaths) {
    const absolutePath = isAbsolute(rawPath)
      ? resolve(rawPath)
      : resolve(resolvedCwd, rawPath);
    if (!(await pathExists(absolutePath))) continue;
    const relativePath = relative(resolvedCwd, absolutePath);
    // Reject paths that escape cwd (e.g. `../outside-project`) so `sg scan`
    // never traverses outside the project directory.
    const escapesCwd =
      relativePath === ".." ||
      relativePath.startsWith(`..${"/"}`) ||
      relativePath.startsWith(`..${"\\"}`) ||
      isAbsolute(relativePath);
    if (escapesCwd) continue;
    kept.push(relativePath === "" ? "." : relativePath);
  }
  return kept;
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
     * defect `241e1c4` fixed for `verify`; `check` had it on the dispatched
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
      const existingPaths = hadExplicitPaths
        ? await filterExistingPaths(cwd, positionalPaths)
        : [];

      // If the user passed paths but none exist (e.g. all-deleted diff),
      // exit cleanly with empty results rather than falling back to a full scan.
      if (hadExplicitPaths && existingPaths.length === 0) {
        if (args.json) {
          console.log(
            JSON.stringify(
              checkOutputSchema.parse({ success: true, results: [] })
            )
          );
        }
        return;
      }

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
              })
            )
          );
        } else {
          console.log(
            "No rules configured. Create one with `taskless rule create`."
          );
        }
        return;
      }

      try {
        // Runtime rules are planned before dispatch, not during it: planning
        // consults auth and reconcile state, which is a decision about *what*
        // may run rather than part of running it.
        const plan = await planRuntime(cwd, runtimeRules, {
          anonymous: args.anonymous,
          dangerouslyRunScripts: Boolean(args["dangerously-run-scripts"]),
        });
        for (const notice of plan.notices) warnNotice(notice);
        for (const skipped of plan.skipped) {
          warnNotice(
            `runtime rule ${skipped.rule} was not run — ${skipped.reason}.`
          );
        }

        // Every engine runs concurrently and merges into one result set. An
        // engine that cannot run reports a notice and the others still return.
        // Assemble both engine configs from the per-rule tree. Each returns
        // `undefined` when its engine has no rules, which dispatch reads as
        // "nothing to run" rather than running an empty config.
        const assembled = await assembleEngineConfigs(
          cwd,
          selection === undefined ? {} : { ruleIds: selection.vale }
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
              : assembled.sg,
          ...(selection === undefined ? {} : { astGrepRuleIds: selection.sg }),
          vale: assembled.vale,
          runtimeRules: plan.execute,
          runtimeTimeoutMs: parseTimeoutMs(args.timeout),
        });
        const results = dispatched.results;

        for (const notice of dispatched.notices) warnNotice(notice);
        const runNotices = [...plan.notices, ...dispatched.notices];
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
        const { exitCode } = dispatched;

        if (args.json) {
          const output = checkOutputSchema.parse({
            success: exitCode === 0,
            results,
            ...(plan.skipped.length > 0 ? { skipped: plan.skipped } : {}),
            ...(dispatched.failures.length > 0
              ? { failures: dispatched.failures }
              : {}),
            // BOTH sources. `plan.notices` carries the repair diagnostics —
            // what was restored, what could not be, and why — and they used to
            // reach only `warn()`, which is a no-op under `--json`. So the one
            // channel a CI run reads dropped the entire output of the feature
            // whose whole purpose is explaining a rule that did not run.
            ...(runNotices.length > 0 ? { notices: runNotices } : {}),
          });
          console.log(JSON.stringify(output));
        } else {
          console.log(formatText(results));
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
      }
    } finally {
      // Concrete state event: a scan completed; counts only, no matched code.
      if (scanCounts) {
        telemetry.capture("cli_check_completed", scanCounts);
      }
    }
  },
});
