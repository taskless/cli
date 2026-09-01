import { resolve, isAbsolute, relative } from "node:path";
import { stat } from "node:fs/promises";
import { defineCommand } from "citty";

import { hasValeRules, runEngines } from "../rules/dispatch";
import { assembleEngineConfigs } from "../rules/assemble";
import { splitRawArguments } from "../util/argv";
import { formatText } from "../util/format";
import { listRuleIds, planEngineDispatch } from "../rules/engines";
import { getTelemetry } from "../telemetry";
import { outputSchema as checkOutputSchema } from "../schemas/check";
import { makeErrorEnvelope } from "../types/errors";
import { CLIError } from "../util/cli-error";
import { getToken } from "../auth/token";
import { resolveOrgSubject } from "../auth/org";
import { resolveRepositoryUrl } from "../util/git-remote";
import { getCliPrefix } from "../util/package-manager";
import { requireCurrentSchema } from "../filesystem/migrate";
import { reconcile } from "../api/reconcile";
import type { ReconcileResponse } from "../api/reconcile";
import { restoreRule } from "../api/restore";
import { repairTargets, verifyRestoredCheck } from "../rules/runtime/repair";
import { writeRuleFile } from "../rules/files";
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
 * Extract positional path arguments from rawArgs. The shared scanner knows the
 * global value-taking flags and the POSIX `--` end-of-options marker (which is
 * what lets a path beginning with `-` be scanned); `--timeout` is check's own
 * value-taking flag, so it is named here rather than in the shared set.
 */
function extractPositionalPaths(rawArguments: string[]): string[] {
  return splitRawArguments(rawArguments, ["--timeout"]).positionals;
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
  // Repair the working tree from the server's verdicts. This changes what the
  // NEXT run sees and nothing about this one: an `unsafe` rule stays withheld
  // below whether or not its bytes were just restored. Fetching code and
  // executing it in the same pass that discovered the drift would move the
  // gate, and the gate is the point.
  const repair = await repairWithheldRules(cwd, token, {
    repositoryUrl,
    result: outcome.result,
  });

  return {
    execute,
    skipped: [
      ...unreadableSkips,
      ...withheld.map((rule) => ({
        rule: rule.name,
        reason: "not blessed by the server (unsafe / unknown / drift)",
      })),
    ],
    notices: repair.notices,
  };
}

/**
 * Act on the verdicts `check` used to parse and discard.
 *
 * `unsafe` and `missing` are repairable and are fetched; `unknown` is not, and
 * gets an explanation instead. Every outcome here is a NOTICE rather than a
 * failure: a rule that could not be repaired is a rule that stays withheld,
 * which is already the safe state. A repair failing must never be the reason a
 * `check` fails.
 */
async function repairWithheldRules(
  cwd: string,
  token: string,
  input: { repositoryUrl: string; result: ReconcileResponse }
): Promise<{ notices: string[] }> {
  const notices: string[] = [];

  // A file this disk holds that the service never issued. There is nothing to
  // fetch, and saying so is the whole job: it reads as an unexplained skip
  // otherwise, and the causes are ordinary (hand-written, or belonging to
  // another organization or installation).
  for (const entry of input.result.unknown) {
    notices.push(
      `${entry.file} was not issued by the rule service, so it cannot be ` +
        `restored and will not run. It was written by hand, or belongs to a ` +
        `different organization or installation.`
    );
  }

  const { targets, unidentifiable } = repairTargets(input.result);
  for (const entry of unidentifiable) {
    notices.push(
      `${entry.file} drifted from the blessed rule, and its rule id could not ` +
        `be read from its path, so it was not restored.`
    );
  }

  // Fetched concurrently: each target is a different rule id under the same
  // token and repository, so they do not order against each other, and a repo
  // with several drifted rules would otherwise pay one round trip per rule on
  // every `check` until they reconverge. The WRITES stay sequential below,
  // because two rules can share a directory prefix and a half-applied set is
  // the state this whole path exists to avoid.
  const fetched = await Promise.all(
    targets.map(async (target) => ({
      target,
      outcome: await restoreRule(token, {
        ruleId: target.ruleId,
        repositoryUrl: input.repositoryUrl,
      }),
    }))
  );

  for (const { target, outcome } of fetched) {
    if (outcome.status !== "ok") {
      notices.push(
        `${target.file} could not be restored (${
          outcome.status === "unauthorized"
            ? "authentication was rejected"
            : outcome.reason
        }).`
      );
      continue;
    }

    const rule = outcome.rules.find(
      (candidate) => candidate.id === target.ruleId
    );
    if (rule === undefined) {
      notices.push(
        `${target.file} could not be restored: the service returned no rule ` +
          `called ${target.ruleId}.`
      );
      continue;
    }

    const verdict = await verifyRestoredCheck(target, rule);
    if (!verdict.ok) {
      notices.push(`${target.file} was not restored: ${verdict.reason}.`);
      continue;
    }

    try {
      await writeRuleFile(cwd, rule);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notices.push(`${target.file} could not be written (${message}).`);
      continue;
    }
    // Says what was written, not what the directory now contains. The
    // delivered set is written over whatever is there; it does not remove a
    // file the set does not mention, so a stray capture left beside the rule
    // survives the repair. Claiming the rule "was restored" would overstate
    // that, and only `check.ts` is signed, so nothing here can vouch for the
    // rest of the directory. Tracked as #233.
    notices.push(
      `${target.file} was rewritten with the bytes the service blessed. It ` +
        `does not run in this pass; the next \`check\` reports the repaired ` +
        `signature and is blessed through the ordinary path.`
    );
  }

  return { notices };
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
    // the machine output stays the
    // { success, results, skipped?, failures?, notices? } shape. Engine
    // failures and notices are carried in that envelope instead, since a
    // machine consumer cannot read stderr prose.
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
            console.log(
              JSON.stringify(
                makeErrorEnvelope(
                  error.code ?? "SCAFFOLD_MIGRATION_REQUIRED",
                  error.message
                )
              )
            );
          } else {
            console.error(`Error: ${error.message}`);
          }
          process.exitCode = 1;
          return;
        }
        throw error;
      }
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
      const runtimeRules = runtimeEnabled
        ? await discoverRuntimeRules(cwd)
        : [];

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
        for (const notice of plan.notices) warn(notice);
        for (const skipped of plan.skipped) {
          warn(
            `Notice: runtime rule ${skipped.rule} was not run — ${skipped.reason}.`
          );
        }

        // Every engine runs concurrently and merges into one result set. An
        // engine that cannot run reports a notice and the others still return.
        // Assemble both engine configs from the per-rule tree. Each returns
        // `undefined` when its engine has no rules, which dispatch reads as
        // "nothing to run" rather than running an empty config.
        const assembled = await assembleEngineConfigs(cwd);
        const dispatched = await runEngines({
          cwd,
          paths: existingPaths,
          astGrepConfigPath: assembled.sg,
          valeConfigPath: assembled.vale,
          runtimeRules: plan.execute,
          runtimeTimeoutMs: parseTimeoutMs(args.timeout),
        });
        const results = dispatched.results;

        for (const notice of dispatched.notices) warn(`Notice: ${notice}`);
        const runNotices = [...plan.notices, ...dispatched.notices];
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
