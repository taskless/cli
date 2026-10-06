import { getToken } from "../auth/token";
import { resolveActingOrg } from "../auth/org";
import { reconcileRules, retryAdvice } from "../api/v2";
import { resolveRepositoryUrl } from "../util/git-remote";
import { getCliPrefix } from "../util/package-manager";
import { recoveryAdvice } from "./recovery-advice";
import { reportRules } from "./report";
import type { RunDirectory } from "./run-directory";
import { RUN_SCRIPTS_WARNING } from "./runtime/harness";
import { discoverRuntimeRulesIn, type RuntimeRule } from "./runtime/discover";
import {
  excludeFromSnapshot,
  snapshotEngineDirectory,
  takeSnapshot,
  type Snapshot,
} from "./snapshot";
import {
  applyVerdicts,
  NOT_IN_PLAN_REASON,
  type IntegrityEntry,
} from "./verdicts";

/**
 * Deciding what a `check` runs, separately from running it.
 *
 * Every path starts from the same snapshot, so there is one execution path and
 * not a verified one and an unverified one that drift apart. What differs by
 * path is only what is judged:
 *
 * - `--dangerously-run-scripts`: nothing. No reconcile, no signatures, every
 *   rule of every engine runs, runtime included. The flag does only what its
 *   name says.
 * - logged out, `--anonymous`, no remote, or a reconcile that cannot complete:
 *   static rules run unverified, runtime rules are skipped, and the exit code
 *   is untouched. Tamper detection needs the service; its absence is not a
 *   failure.
 * - a completed reconcile: the verdict policy in `verdicts.ts`, and whatever it
 *   excludes is removed from the snapshot before any engine is configured.
 *
 * `check` never writes `.taskless/rules/`. An edited or missing rule gets a
 * notice naming `rule restore`, or the git steps when the plan is known not
 * to serve it (`recovery-advice.ts`); nothing here fetches bytes.
 */

/** A runtime rule that will not run, with why. */
export interface SkippedRuntimeRule {
  rule: string;
  reason: string;
}

/** The plan outcome for an organization whose plan withholds runtime rules. */
export interface PlanEntitlement {
  runtimeSignatures: false;
  reason?: string;
  upgradeUrl?: string;
  /** Local rule names the service withheld. Non-empty means `check` fails. */
  withheld: string[];
}

export interface CheckPlan {
  snapshot: Snapshot;
  /** Runtime rules to execute, from the snapshot. */
  execute: RuntimeRule[];
  skipped: SkippedRuntimeRule[];
  notices: string[];
  /** Reasons the run fails whatever the findings. */
  failures: string[];
  integrity: IntegrityEntry[];
  entitlement?: PlanEntitlement;
}

export interface PlanOptions {
  anonymous: boolean;
  dangerouslyRunScripts: boolean;
}

/**
 * Snapshot the rules tree and decide what runs.
 */
export async function planCheck(
  cwd: string,
  run: RunDirectory,
  options: PlanOptions
): Promise<CheckPlan> {
  const log = run.logs.engine;
  const snapshot = await takeSnapshot(cwd, run);
  log.write(`snapshot taken at ${snapshot.base}`);
  const runtimeRoot = snapshotEngineDirectory(snapshot, "runtime");
  const discovered = await discoverRuntimeRulesIn(runtimeRoot);
  const empty = {
    snapshot,
    execute: [],
    skipped: [],
    notices: [],
    failures: [],
    integrity: [],
  };

  if (options.dangerouslyRunScripts) {
    log.write(
      "--dangerously-run-scripts: no reconcile; every rule runs unverified"
    );
    return { ...empty, execute: discovered, notices: [RUN_SCRIPTS_WARNING] };
  }

  const unverified = (reason: string, notice?: string): CheckPlan => {
    log.write(`unverified run: ${reason}`);
    return {
      ...empty,
      skipped: discovered.map((rule) => ({ rule: rule.name, reason })),
      notices: notice === undefined ? [] : [notice],
    };
  };

  if (options.anonymous) {
    return unverified(
      "anonymous mode — runtime rules were not verified and did not run"
    );
  }
  const token = await getToken(cwd, { silent: true });
  if (!token) {
    return unverified(
      "not authenticated — runtime rules were not verified and did not run"
    );
  }
  let repositoryUrl: string;
  try {
    repositoryUrl = await resolveRepositoryUrl(cwd);
  } catch {
    return unverified(
      "no GitHub remote — runtime rules could not be verified and did not run"
    );
  }

  const report = await reportRules(snapshot);
  log.write(
    `reporting ${String(report.rules.length)} rule(s): ` +
      report.rules
        .map(
          (rule) =>
            `${rule.engine}/${rule.ruleId} (${String(rule.files.length)} files)`
        )
        .join(", ")
  );
  for (const duplicate of report.duplicates) {
    log.write(
      `duplicate id ${duplicate.ruleId} across ${duplicate.engines.join(", ")}`
    );
  }
  for (const rule of report.unreadable) {
    log.write(`unreadable ${rule.engine}/${rule.ruleId}: ${rule.reason}`);
  }
  const failures: string[] = [];
  const integrity: IntegrityEntry[] = [];

  // A rule that cannot be judged must not run as though it had been. Both are
  // removed from the snapshot and fail the run.
  for (const duplicate of report.duplicates) {
    for (const engine of duplicate.engines) {
      await excludeFromSnapshot(snapshot, engine, duplicate.ruleId);
    }
    integrity.push({ ruleId: duplicate.ruleId, verdict: "duplicate" });
    failures.push(
      `rule id ${duplicate.ruleId} is used by more than one engine (` +
        duplicate.engines
          .map((engine) => `.taskless/rules/${engine}/${duplicate.ruleId}/`)
          .join(", ") +
        "), so neither can be verified and neither ran. Rename one."
    );
  }
  for (const rule of report.unreadable) {
    await excludeFromSnapshot(snapshot, rule.engine, rule.ruleId);
    integrity.push({
      ruleId: rule.ruleId,
      engine: rule.engine,
      verdict: "unaccounted",
    });
    failures.push(
      `${rule.engine} rule ${rule.ruleId} could not be read (${rule.reason}), so it was not verified and did not run.`
    );
  }
  if (report.duplicates.length > 0) {
    // Refused before reconcile: the report would name one id for two rules.
    const remaining = await discoverRuntimeRulesIn(runtimeRoot);
    return {
      ...empty,
      skipped: remaining.map((rule) => ({
        rule: rule.name,
        reason: "rule ids collide across engines, so nothing was verified",
      })),
      failures,
      integrity,
    };
  }

  const org = await resolveActingOrg(cwd, token);
  const outcome = await reconcileRules(token, {
    orgId: org.subject,
    repositoryUrl,
    rules: report.rules.map(({ ruleId, files }) => ({ ruleId, files })),
  });

  log.write(
    outcome.status === "ok"
      ? "reconcile answered"
      : `reconcile did not answer: ${outcome.status}${
          outcome.status === "error"
            ? ` (${outcome.code})`
            : outcome.status === "unavailable"
              ? ` (${outcome.reason})`
              : ""
        }`
  );
  if (outcome.status !== "ok") {
    const cause = reconcileFailureCause(outcome);
    const remaining = await discoverRuntimeRulesIn(runtimeRoot);
    return {
      ...empty,
      skipped: remaining.map((rule) => ({ rule: rule.name, reason: cause })),
      notices: [
        `Rule verification could not be performed: ${cause}. Static rules ran unverified and runtime rules did not run.${
          outcome.status === "unavailable" ? retryAdvice(outcome) : ""
        }`,
      ],
      failures,
      integrity,
    };
  }

  const verdicts = applyVerdicts(
    report.rules,
    outcome.data,
    recoveryAdvice(
      org.restoreRules,
      (ruleId) => `${getCliPrefix()} rule restore ${ruleId}`
    )
  );
  for (const disposition of verdicts.dispositions) {
    log.write(
      `${disposition.engine}/${disposition.ruleId}: ${disposition.verdict}, ${
        disposition.run
          ? "runs"
          : `excluded (${disposition.reason ?? "not verified"})`
      }`
    );
    if (!disposition.run) {
      await excludeFromSnapshot(
        snapshot,
        disposition.engine,
        disposition.ruleId
      );
    }
  }
  for (const entry of verdicts.integrity) {
    if (entry.verdict === "missing") {
      log.write(
        `missing: ${entry.ruleId} (revision ${entry.revisionId ?? "unknown"})`
      );
    }
    if (entry.copyOf !== undefined) {
      log.write(
        `copy: ${entry.ruleId} carries files of ${entry.copyOf.ruleId} (revision ${
          entry.copyOf.revisionId ?? "unknown"
        })${entry.copyOf.sourceMissing ? ", which is missing: a rename" : ""}`
      );
    }
  }

  const execute = await discoverRuntimeRulesIn(runtimeRoot);
  const executing = new Set(execute.map((rule) => rule.name));
  const skipped: SkippedRuntimeRule[] = [];
  for (const disposition of verdicts.dispositions) {
    if (disposition.engine !== "runtime") continue;
    if (!disposition.run) {
      skipped.push({
        rule: disposition.ruleId,
        reason: disposition.reason ?? "not verified",
      });
    } else if (!executing.has(disposition.ruleId)) {
      // Verified, then not runnable: no capture rules, or a stray module
      // beside check.ts. Named, because a rule in neither list reads as a rule
      // that ran and found nothing.
      skipped.push({
        rule: disposition.ruleId,
        reason:
          "verified by the server, but it is not a runnable runtime rule (run `verify` for why)",
      });
    }
  }

  const entitlement: PlanEntitlement | undefined =
    verdicts.entitlement === undefined
      ? undefined
      : {
          runtimeSignatures: false,
          ...(verdicts.entitlement.reason === undefined
            ? {}
            : { reason: verdicts.entitlement.reason }),
          ...(verdicts.entitlement.upgradeUrl === undefined
            ? {}
            : { upgradeUrl: verdicts.entitlement.upgradeUrl }),
          withheld: verdicts.withheld,
        };

  return {
    snapshot,
    execute,
    skipped,
    notices: [
      ...(entitlement === undefined || entitlement.withheld.length === 0
        ? []
        : [withheldNotice(entitlement)]),
      ...verdicts.notices,
    ],
    failures: [...failures, ...verdicts.failures],
    integrity: [...integrity, ...verdicts.integrity],
    ...(entitlement === undefined ? {} : { entitlement }),
  };
}

/** The one notice a withheld run prints, so the upgrade URL appears once. */
function withheldNotice(entitlement: PlanEntitlement): string {
  const count = entitlement.withheld.length;
  return (
    `${String(count)} runtime ${count === 1 ? "rule was" : "rules were"} ` +
    `withheld because runtime rules are ${NOT_IN_PLAN_REASON}` +
    (entitlement.reason === undefined ? "" : ` (${entitlement.reason})`) +
    `: ${entitlement.withheld.join(", ")}. \`check\` fails until they can run` +
    (entitlement.upgradeUrl === undefined
      ? "."
      : `. Upgrade at ${entitlement.upgradeUrl}`)
  );
}

/**
 * Why reconcile gave no verdicts, as a clause for the notice and each skipped
 * rule.
 *
 * "Unavailable" is kept for the service not answering. A documented code is an
 * answer, and calling it an outage sends the user to retry something that
 * will be rejected identically every time.
 */
function reconcileFailureCause(
  outcome: Exclude<Awaited<ReturnType<typeof reconcileRules>>, { status: "ok" }>
): string {
  switch (outcome.status) {
    case "unauthorized": {
      return `authentication was rejected — run \`${getCliPrefix()} auth login\` to re-authenticate`;
    }
    case "unavailable": {
      return `the rule service was unavailable (${outcome.reason})`;
    }
    case "refused": {
      return "the rule service answered with an unexpected refusal";
    }
    case "error": {
      if (outcome.code === "organization_not_found") {
        return "the Taskless GitHub App installation does not cover this repository, or your login lost access to the organization";
      }
      return `the rule service rejected the verification request (${outcome.code}${
        outcome.details?.length ? `: ${outcome.details.join(", ")}` : ""
      })`;
    }
  }
}
