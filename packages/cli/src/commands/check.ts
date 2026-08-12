import { resolve, join, isAbsolute, relative } from "node:path";
import { stat } from "node:fs/promises";
import { defineCommand } from "citty";

import { hasValeRules, runEngines } from "../rules/dispatch";
import { formatText } from "../util/format";
import { resolveSgConfigPath } from "../filesystem/sgconfig";
import { ensureTasklessDirectory } from "../filesystem/directory";
import {
  discoverAstGrepRuleSources,
  planEngineDispatch,
} from "../rules/engines";
import { getTelemetry } from "../telemetry";
import { outputSchema as checkOutputSchema } from "../schemas/check";
import { makeErrorEnvelope } from "../types/errors";
import { getToken } from "../auth/token";
import { resolveOrgSubject } from "../auth/org";
import { resolveRepositoryUrl } from "../util/git-remote";
import { getCliPrefix } from "../util/package-manager";
import { reconcile } from "../api/reconcile";
import {
  discoverRuntimeRules,
  type RuntimeRule,
} from "../rules/runtime/discover";
import {
  materializeRuntimeRules,
  reportRuntimeChecks,
  selectBlessedRuntimeRules,
  signRuntimeChecks,
} from "../rules/runtime/run-set";

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
 * Extract positional arguments from rawArgs. citty's rawArgs contains the
 * original argv for this subcommand, so we drop anything starting with `-`
 * and drop known flag values (e.g. `-d <value>`). Once `--` is seen, all
 * remaining arguments are treated as positional paths (conventional POSIX
 * end-of-options marker), which lets users pass paths that begin with `-`.
 */
function extractPositionalPaths(rawArguments: string[]): string[] {
  const paths: string[] = [];
  let afterDoubleDash = false;
  for (let index = 0; index < rawArguments.length; index++) {
    const argument = rawArguments[index]!;
    if (afterDoubleDash) {
      paths.push(argument);
      continue;
    }
    if (argument === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (argument.startsWith("-")) {
      // Skip value for short/long flags that take a value
      if (
        (argument === "-d" ||
          argument === "--dir" ||
          argument === "--timeout") &&
        index + 1 < rawArguments.length
      ) {
        index += 1;
      }
      continue;
    }
    paths.push(argument);
  }
  return paths;
}

/** A runtime rule that will not run, with why (advisory). */
interface SkippedRuntimeRule {
  rule: string;
  reason: string;
}

/** The runtime-execution plan resolved from auth state and flags. */
interface RuntimePlan {
  /** Rules to execute — materialized when gated, live under `--dangerously-run-scripts`. */
  execute: RuntimeRule[];
  /** Rules that will not run, with a reason. */
  skipped: SkippedRuntimeRule[];
  /** Human-only notices about the runtime disposition. */
  notices: string[];
}

/** Skip every runtime rule with a shared reason (an unverified path). */
function skipAllRuntime(rules: RuntimeRule[], reason: string): RuntimePlan {
  return {
    execute: [],
    skipped: rules.map((rule) => ({ rule: rule.name, reason })),
    notices: [],
  };
}

/**
 * Decide which runtime rules run. A runtime rule's `check.ts` is arbitrary code
 * execution, so it runs only when its signature is server-validated (an
 * authenticated reconcile that returns it in `run`) or `--dangerously-run-scripts`
 * is set. Every unverified path — anonymous, logged out, no remote, or a
 * reconcile that cannot complete — skips runtime rules without failing.
 */
async function planRuntime(
  cwd: string,
  discovered: RuntimeRule[],
  options: { anonymous: boolean; dangerouslyRunScripts: boolean }
): Promise<RuntimePlan> {
  if (discovered.length === 0) return { execute: [], skipped: [], notices: [] };

  if (options.dangerouslyRunScripts) {
    return {
      execute: discovered,
      skipped: [],
      notices: [
        "Warning: --dangerously-run-scripts is executing runtime rule code without server verification.",
      ],
    };
  }

  if (options.anonymous) {
    return skipAllRuntime(
      discovered,
      "anonymous mode — runtime rules were not verified and did not run"
    );
  }

  const token = await getToken(cwd, { silent: true });
  if (!token) {
    return skipAllRuntime(
      discovered,
      "not authenticated — runtime rules were not verified and did not run"
    );
  }

  let repositoryUrl: string;
  try {
    repositoryUrl = await resolveRepositoryUrl(cwd);
  } catch {
    return skipAllRuntime(
      discovered,
      "no GitHub remote — runtime rules could not be verified and did not run"
    );
  }

  // A rule whose check.ts is missing/unreadable is reported, not fatal: signing
  // never throws, and such rules are surfaced as skipped so static checks and
  // the other runtime rules are unaffected.
  const { signed, unreadable } = await signRuntimeChecks(discovered);
  const unreadableSkips: SkippedRuntimeRule[] = unreadable.map((rule) => ({
    rule: rule.name,
    reason: "its check.ts is missing or unreadable",
  }));

  const orgSubject = await resolveOrgSubject(cwd, token);
  const outcome = await reconcile(token, {
    orgId: orgSubject,
    repositoryUrl,
    files: reportRuntimeChecks(cwd, signed),
  });

  if (outcome.status === "unauthorized") {
    return skipAllRuntime(
      discovered,
      `authentication was rejected — run \`${getCliPrefix()} auth login\` to re-authenticate`
    );
  }
  if (outcome.status === "unavailable") {
    return skipAllRuntime(
      discovered,
      `the rule service was unavailable (${outcome.reason})`
    );
  }

  const { blessed, withheld } = selectBlessedRuntimeRules(
    signed,
    outcome.result.run
  );
  let execute: RuntimeRule[] = [];
  try {
    execute =
      blessed.length > 0 ? await materializeRuntimeRules(cwd, blessed) : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return skipAllRuntime(
      discovered,
      `runtime rules could not be materialized (${message})`
    );
  }
  return {
    execute,
    skipped: [
      ...unreadableSkips,
      ...withheld.map((rule) => ({
        rule: rule.name,
        reason: "not blessed by the server (unsafe / unknown / drift)",
      })),
    ],
    notices: [],
  };
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
  },
  async run({ args, rawArgs }) {
    const cwd = resolve(args.dir ?? process.cwd());
    const telemetry = await getTelemetry(cwd);

    // Warnings/notices are advisory human output; suppress them under --json so
    // the machine output stays the { success, results, skipped? } shape.
    const warn = (message: string) => {
      if (!args.json) console.error(message);
    };

    // Set when a scan actually runs; drives cli_check_completed with counts
    // only (never matched code).
    let scanCounts:
      | { errorCount: number; warningCount: number; findings: number }
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

      // Rules dispatch by the engine directory that contains them. This is also
      // the migration trigger: no config is generated on the check path any
      // more, so without this call an upgraded CLI would keep reading a stale
      // layout.
      //
      // Only an existing `.taskless/` is migrated. `ensureTasklessDirectory`
      // creates the scaffold, and `check` is a read-only command — running it in
      // a project that has none should report that, not write one (and not fail
      // on a read-only filesystem).
      if (await pathExists(join(cwd, ".taskless"))) {
        await ensureTasklessDirectory(cwd);
      }
      const dispatch = await planEngineDispatch(cwd);

      // Static rules (trusted ast-grep YAML) always run; runtime rules
      // (untrusted check.ts) are gated separately. Vale is discovered below,
      // in the "anything to run?" gate — every known engine now has an
      // executor, so none of them can be assumed to contribute nothing. A
      // directory that is not a known engine is still ignored rather than
      // handed to someone's parser.
      const astGrepSources = await discoverAstGrepRuleSources(cwd);
      // Both halves matter: `executor` alone is read from the static layout
      // table and is therefore always `runtime-harness`, so gating on it only
      // would make this unconditionally true and the presence check decorative.
      const runtimeDispatch = dispatch.find(
        (entry) => entry.engine === "runtime"
      );
      const runtimeEnabled =
        runtimeDispatch?.present === true &&
        runtimeDispatch.executor === "runtime-harness";
      const runtimeRules = runtimeEnabled
        ? await discoverRuntimeRules(cwd)
        : [];

      // "No rules configured" has to mean *no engine* has any, not just these
      // two: a project whose only rules live in `.taskless/vale/rules/` would
      // otherwise return here and Vale would never be dispatched, which is a
      // silent skip of the engine the user actually configured. Asked last and
      // short-circuited, so the ordinary project with ast-grep or runtime rules
      // pays nothing and `runEngines` still owns the decision to spawn Vale.
      const noRuleFiles =
        astGrepSources.length === 0 &&
        runtimeRules.length === 0 &&
        !(await hasValeRules(cwd));

      if (noRuleFiles) {
        if (args.json) {
          console.log(
            JSON.stringify(
              checkOutputSchema.parse({ success: true, results: [] })
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
        for (const notice of plan.notices) warn(notice);
        for (const skipped of plan.skipped) {
          warn(
            `Notice: runtime rule ${skipped.rule} was not run — ${skipped.reason}.`
          );
        }

        // Every engine runs concurrently and merges into one result set. An
        // engine that cannot run reports a notice and the others still return.
        const astGrepConfigPaths = await Promise.all(
          astGrepSources.map((source) => resolveSgConfigPath(cwd, source))
        );
        const dispatched = await runEngines({
          cwd,
          paths: existingPaths,
          astGrepConfigPaths,
          runtimeRules: plan.execute,
          runtimeTimeoutMs: parseTimeoutMs(args.timeout),
        });
        const results = dispatched.results;

        for (const notice of dispatched.notices) warn(`Notice: ${notice}`);
        for (const failure of dispatched.failures) warn(`Error: ${failure}`);

        let errorCount = 0;
        let warningCount = 0;
        for (const result of results) {
          if (result.severity === "error") errorCount++;
          else if (result.severity === "warning") warningCount++;
        }
        scanCounts = { errorCount, warningCount, findings: results.length };

        // Computed by `runEngines`, not here: the exit code is a fact about a
        // completed dispatch, and an engine failure has to fail the check even
        // with no findings.
        const { exitCode } = dispatched;

        if (args.json) {
          const output = checkOutputSchema.parse({
            success: exitCode === 0,
            results,
            ...(plan.skipped.length > 0 ? { skipped: plan.skipped } : {}),
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
        if (args.json) {
          console.log(
            JSON.stringify(makeErrorEnvelope("SCAN_FAILED", message))
          );
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
