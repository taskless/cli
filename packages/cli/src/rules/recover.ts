import {
  listRevisions,
  reconcileRules,
  restoreRule,
  retryAdvice,
  rollbackRule,
  type RevisionList,
  type ServedRule,
  type V2Outcome,
} from "../api/v2";
import { notRunOnPlanSentence, parseEntitlementV2 } from "../api/entitlement";
import { describeRefusal } from "../api/refusal";
import type { Identity } from "../auth/identity";
import { CLIError } from "../util/cli-error";
import { isRecord } from "../util/is-record";
import { getCliPrefix } from "../util/package-manager";
import { PurgeIncompleteError } from "./deliver";
import { ruleFilePath } from "./engines";
import { writeServedRule } from "./files";
import { orgNotFoundMessage } from "./generate";
import { isKnownEngine, type EngineName } from "./layout";
import { reportRules } from "./report";
import { openRun } from "./run-directory";
import { takeSnapshot } from "./snapshot";
import { verifyServedRule } from "./verify-delivery";

/**
 * `rule restore` and `rule rollback`: the only commands that write a rule the
 * service already issued back into `.taskless/rules/`.
 *
 * `check` never does this. It reports an edited or missing rule and names
 * `rule restore`, because a lint that rewrites the tree it lints cannot be
 * reasoned about in CI or in a hook.
 *
 * **Restore repairs, it never advances.** The service answers restore with the
 * rule's CURRENT revision. That is not always what reconcile compared against:
 * a rule issued twice resolves to the newest issue. So restore first asks
 * reconcile what this rule should be, and refuses served bytes that differ,
 * rather than trusting the served set's own signatures alone. Those only prove
 * the bytes are intact, not that they are the right ones.
 */

/** What a successful recovery wrote. */
export interface Recovered {
  ruleId: string;
  revisionId: string;
  files: string[];
  notices: string[];
}

/** What restore found before it asked for anything. */
export type RestoreStart =
  | { kind: "intact"; message: string }
  | { kind: "restore"; expect: Expectation };

type Expectation =
  | { verdict: "unsafe"; engine: EngineName; signatures: Map<string, string> }
  | { verdict: "missing"; engine: EngineName; revisionId: string };

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((entry) => isRecord(entry)) : [];
}

/**
 * Map a v2 failure to the error a recovery command reports.
 *
 * `notFound` replaces the `rule_not_found` message for a route where that code
 * means less than it does on restore, which also answers it for a rule that
 * exists only on an open pull request.
 */
function failure(
  outcome: Exclude<V2Outcome<unknown, string>, { status: "ok" }>,
  ruleId: string,
  notFound?: string
): CLIError {
  switch (outcome.status) {
    case "refused": {
      return new CLIError(
        describeRefusal(outcome.refusal),
        "RULE_RECOVERY_NOT_IN_PLAN"
      );
    }
    case "unauthorized": {
      return new CLIError(
        `Authentication was rejected. Run \`${getCliPrefix()} auth login\` and try again.`,
        "AUTH_REQUIRED"
      );
    }
    case "unavailable": {
      return new CLIError(
        `The rule service was unavailable (${outcome.reason}).${retryAdvice(outcome)}`,
        "NETWORK_ERROR"
      );
    }
    case "error": {
      switch (outcome.code) {
        case "rule_not_found": {
          return new CLIError(
            notFound ??
              `Rule ${ruleId} is not a rule Taskless issued for this repository, or it only exists on an open pull request, so there is nothing to recover.`,
            "RULE_NOT_FOUND"
          );
        }
        case "revision_not_found": {
          return new CLIError(
            `That revision is not a revision of rule ${ruleId}. Run \`${getCliPrefix()} rule revisions ${ruleId}\` to list its revisions.`,
            "REVISION_NOT_FOUND"
          );
        }
        case "organization_not_found": {
          return new CLIError(orgNotFoundMessage(), "NETWORK_ERROR");
        }
        case "rule_not_restorable": {
          return new CLIError(
            `The rule service holds rule ${ruleId} but could not serve it (rule_not_restorable). This is a service defect; report it.`,
            "NETWORK_ERROR"
          );
        }
        case "validation_error": {
          return new CLIError(
            `The rule service rejected the request as invalid: ${(outcome.details ?? []).join(", ") || "no details were given"}.`,
            "INVALID_INPUT"
          );
        }
        default: {
          return new CLIError(
            `The rule service refused the request (${outcome.code}${
              outcome.details?.length ? `: ${outcome.details.join(", ")}` : ""
            }).`,
            "NETWORK_ERROR"
          );
        }
      }
    }
  }
}

/**
 * Snapshot, report, and reconcile the whole tree exactly as `check` would, then
 * read only `ruleId`'s outcome.
 *
 * The whole tree, not just this rule: a report of one rule would come back with
 * every other issued rule `missing`, which is noise, and a rule's verdict does
 * not depend on its siblings anyway.
 */
export async function beginRestore(
  cwd: string,
  identity: Identity,
  ruleId: string
): Promise<RestoreStart> {
  // Its own run directory, for the snapshot only: restore needs the report,
  // never the copy, so the directory goes as soon as the report is taken.
  const run = await openRun(cwd);
  let report;
  try {
    report = await reportRules(await takeSnapshot(cwd, run));
  } finally {
    await run.close();
  }
  const duplicate = report.duplicates.find((entry) => entry.ruleId === ruleId);
  if (duplicate !== undefined) {
    throw new CLIError(
      `Rule id ${ruleId} is used by more than one engine (${duplicate.engines.join(", ")}). Rename the local one before restoring.`,
      "RULE_ID_AMBIGUOUS"
    );
  }
  const unreadable = report.unreadable.find((entry) => entry.ruleId === ruleId);
  if (unreadable !== undefined) {
    throw new CLIError(
      `Rule ${ruleId} could not be read (${unreadable.reason}).`,
      "INTERNAL_ERROR"
    );
  }
  const local = report.rules.find((rule) => rule.ruleId === ruleId);

  const outcome = await reconcileRules(identity.token, {
    orgId: identity.orgSubject,
    repositoryUrl: identity.repositoryUrl,
    rules: report.rules.map(({ ruleId: id, files }) => ({ ruleId: id, files })),
  });
  if (outcome.status !== "ok") throw failure(outcome, ruleId);
  const body: Record<string, unknown> = isRecord(outcome.data)
    ? outcome.data
    : {};

  const entitlement = parseEntitlementV2(body.entitlement);
  if (entitlement?.withheld.some((entry) => entry.ruleId === ruleId)) {
    return {
      kind: "intact",
      message: `Rule ${ruleId} is exactly what Taskless issued; it is withheld only because runtime rules are not in your plan. Restoring it would change nothing.`,
    };
  }
  if (
    records(body.unknown).some((entry) => entry.ruleId === ruleId) ||
    (local === undefined &&
      !records(body.rules).some((entry) => entry.ruleId === ruleId))
  ) {
    throw new CLIError(
      `Rule ${ruleId} was not issued by Taskless for this repository (it was written locally, belongs to another repository, or predates CLI 0.12.0), so there is nothing to restore.`,
      "RULE_NOT_FOUND"
    );
  }

  const verdict = records(body.rules).find((entry) => entry.ruleId === ruleId);
  // The engine the service judged, exactly as `check` reads it: without one
  // the verdict cannot be tied to a directory, and restore would write
  // wherever the served set happens to point.
  const judged =
    typeof verdict?.engine === "string" && isKnownEngine(verdict.engine)
      ? verdict.engine
      : undefined;
  switch (verdict?.verdict) {
    case "run": {
      return {
        kind: "intact",
        message: `Rule ${ruleId} already matches a revision Taskless issued. Nothing to restore.`,
      };
    }
    case "unsafe": {
      if (local === undefined || judged === undefined) break;
      if (judged !== local.engine) {
        throw new CLIError(
          `The rule service judged rule ${ruleId} as a ${judged} rule, but it is a ${local.engine} rule here, so nothing was restored.`,
          "NETWORK_ERROR"
        );
      }
      const signatures = new Map(
        local.files.map((file) => [file.path, file.signature])
      );
      for (const entry of records(verdict.files)) {
        if (typeof entry.path !== "string") continue;
        if (typeof entry.expected === "string") {
          signatures.set(entry.path, entry.expected);
        } else {
          // Reported but never issued: it must not be in what comes back.
          signatures.delete(entry.path);
        }
      }
      return {
        kind: "restore",
        expect: { verdict: "unsafe", engine: local.engine, signatures },
      };
    }
    case "missing": {
      // `missing` names a rule that was NOT reported, which is how `check`
      // reads it too. Against a rule that is on disk it is not a verdict, and
      // acting on it would overwrite local content nothing compared.
      if (local !== undefined) {
        throw new CLIError(
          `The rule service answered that rule ${ruleId} is missing, but it is in .taskless/rules/${local.engine}/. That is not an answer restore can act on, so nothing was restored.`,
          "NETWORK_ERROR"
        );
      }
      if (typeof verdict.revisionId !== "string" || judged === undefined) {
        break;
      }
      return {
        kind: "restore",
        expect: {
          verdict: "missing",
          engine: judged,
          revisionId: verdict.revisionId,
        },
      };
    }
    default: {
      break;
    }
  }
  throw new CLIError(
    `The rule service's answer for rule ${ruleId} could not be read, so nothing was restored.`,
    "NETWORK_ERROR"
  );
}

/** Restore `ruleId` to what reconcile said it should be. */
export async function restore(
  cwd: string,
  identity: Identity,
  ruleId: string,
  expect: Expectation
): Promise<Recovered> {
  const outcome = await restoreRule(identity.token, ruleId, {
    repositoryUrl: identity.repositoryUrl,
    orgId: identity.orgSubject,
  });
  if (outcome.status !== "ok") throw failure(outcome, ruleId);

  const verdict = await verifyServedRule(outcome.data, {
    ruleId,
    ...(expect.verdict === "missing" ? { revisionId: expect.revisionId } : {}),
  });
  if (!verdict.ok) {
    throw new CLIError(
      `Rule ${ruleId} was not restored: ${verdict.reason}. Nothing was written.`,
      "RULE_RESTORE_MISMATCH"
    );
  }

  const servedEngine: string = verdict.fileSet.engine;
  if (servedEngine !== expect.engine) {
    throw new CLIError(
      `Rule ${ruleId} was not restored: the service served it as a ${servedEngine} rule, but reconcile judged it as a ${expect.engine} rule. Nothing was written.`,
      "RULE_RESTORE_MISMATCH"
    );
  }

  if (expect.verdict === "unsafe") {
    const served = new Map(
      verdict.fileSet.signatures.map((entry) => [entry.path, entry.signature])
    );
    const differs =
      served.size !== expect.signatures.size ||
      [...expect.signatures].some(([path, sig]) => served.get(path) !== sig);
    if (differs) {
      throw new CLIError(
        `Rule ${ruleId} was not restored: the service served revision ${verdict.revisionId}, which is not the revision reconcile compared this rule against. Restore repairs a rule, it does not upgrade one. Nothing was written.`,
        "RULE_RESTORE_MISMATCH"
      );
    }
  }

  return write(
    cwd,
    outcome.data,
    verdict.fileSet,
    verdict.revisionId,
    "restored"
  );
}

/** Make `revisionId` the rule's current revision and write it. */
export async function rollback(
  cwd: string,
  identity: Identity,
  ruleId: string,
  revisionId: string
): Promise<Recovered> {
  const outcome = await rollbackRule(identity.token, ruleId, {
    repositoryUrl: identity.repositoryUrl,
    revisionId,
    orgId: identity.orgSubject,
  });
  if (outcome.status !== "ok") throw failure(outcome, ruleId);

  const verdict = await verifyServedRule(outcome.data, { ruleId, revisionId });
  if (!verdict.ok) {
    throw new CLIError(
      `Rule ${ruleId} was not rolled back on disk: ${verdict.reason}. Nothing was written.`,
      "RULE_RESTORE_MISMATCH"
    );
  }
  return write(cwd, outcome.data, verdict.fileSet, revisionId, "rolled back");
}

async function write(
  cwd: string,
  served: ServedRule,
  fileSet: Parameters<typeof writeServedRule>[1],
  revisionId: string,
  verb: string
): Promise<Recovered> {
  const notices: string[] = [];
  let ruleFile: string;
  try {
    ruleFile = await writeServedRule(cwd, fileSet, (message) =>
      notices.push(message)
    );
  } catch (error) {
    if (error instanceof PurgeIncompleteError) {
      notices.push(
        `Rule ${fileSet.id} was ${verb}, but ${String(error.failures.length)} stale ${error.failures.length === 1 ? "entry" : "entries"} could not be removed and an engine still reads ${error.failures.length === 1 ? "it" : "them"}: ${error.failures.join(", ")}.`
      );
      // Thrown only after every delivered file was written: the rule IS on
      // disk, so `files` says so. Only the stale entries beside it failed.
      const engine: string = fileSet.engine;
      return {
        ruleId: fileSet.id,
        revisionId,
        files: isKnownEngine(engine)
          ? [ruleFilePath(cwd, engine, fileSet.id)]
          : [],
        notices,
      };
    }
    throw error;
  }

  const entitlement =
    fileSet.engine === "runtime"
      ? parseEntitlementV2(served.entitlement)
      : undefined;
  notices.push(
    entitlement === undefined
      ? `Rule ${fileSet.id} was ${verb} to revision ${revisionId}. The next \`check\` verifies it.`
      : `Rule ${fileSet.id} was ${verb} to revision ${revisionId}. ${notRunOnPlanSentence(entitlement)}`
  );
  return { ruleId: fileSet.id, revisionId, files: [ruleFile], notices };
}

/**
 * List `ruleId`'s recent revisions, to choose one for `rule rollback`.
 *
 * Read-only and served on every plan, so unlike restore and rollback there is
 * no refusal to relay and nothing is reconciled first.
 */
export async function revisions(
  identity: Identity,
  ruleId: string
): Promise<RevisionList> {
  const outcome = await listRevisions(identity.token, ruleId, {
    repositoryUrl: identity.repositoryUrl,
    orgId: identity.orgSubject,
  });
  if (outcome.status !== "ok") {
    throw failure(
      outcome,
      ruleId,
      `Rule ${ruleId} is not a rule Taskless issued for this repository, so it has no revisions.`
    );
  }
  return outcome.data;
}

/**
 * The listing as a person reads it. Order is the service's; the current
 * revision is found by its flag, because one older than the newest ten is
 * appended after them.
 *
 * `restoreRules` is the acting org's plan entitlement. Only `false` changes
 * anything: the listing is the same on every plan, but the closing line stops
 * naming `rule rollback`, which the service would refuse. Unknown names it, as
 * before, and rollback still asks the service either way.
 */
export function describeRevisions(
  list: RevisionList,
  restoreRules?: boolean
): string[] {
  const { ruleId } = list;
  if (list.revisions.length === 0) {
    return [`Rule ${ruleId} has no revisions.`];
  }
  const lines = [`Revisions of rule ${ruleId}, newest first:`, ""];
  for (const revision of list.revisions) {
    const fields = [
      revision.current ? "*" : " ",
      revision.revisionId,
      revision.createdAt,
      revision.delivery,
      ...(revision.prUrl === undefined ? [] : [revision.prUrl]),
      ...(revision.current ? ["(current)"] : []),
    ];
    lines.push(fields.join("  "));
  }
  lines.push("");
  if (list.truncated) {
    lines.push(
      "Older revisions exist and are not listed here; the rule's page on the Taskless dashboard lists every one."
    );
  }
  if (!list.revisions.some((revision) => revision.current)) {
    lines.push(
      `Rule ${ruleId} has no current revision: it exists only on a pull request that has not merged, and gets one when that pull request merges.`
    );
  }
  lines.push(
    restoreRules === false
      ? "Rolling back is not included in your organization's plan; earlier versions of this rule are in the repository's git history."
      : `Make a revision current with \`${getCliPrefix()} rule rollback ${ruleId} <revisionId>\`.`
  );
  return lines;
}
