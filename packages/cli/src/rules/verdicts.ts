import { parseEntitlementV2, type EntitlementV2 } from "../api/entitlement";
import { isRecord } from "../util/is-record";
import type { EngineName } from "./layout";
import { isKnownEngine } from "./layout";
import type { ReportedRule } from "./report";

/**
 * Turning a v2 reconcile answer into what `check` does with each rule.
 *
 * Pure, and deliberately so: this is the policy, and every row of it is a
 * decision about whether edited code runs or a run goes green. It is tested as
 * a table rather than through a mocked network, because the network is not
 * what can be wrong here.
 *
 * | Verdict      | runtime                         | sg / vale                        |
 * |--------------|---------------------------------|----------------------------------|
 * | `run`        | execute                         | run                              |
 * | withheld     | not executed; fails             | (never sent)                     |
 * | `unsafe`     | not executed; restore offered   | not run; FAILS; restore offered  |
 * | `missing`    | warn; restore offered           | warn; restore offered            |
 * | `unknown`    | not executed                    | run, silently                    |
 * | unaccounted  | not executed; fails             | not run; fails                   |
 *
 * **Accounting is computed, not trusted.** Every reported rule must land in
 * exactly one of `rules`, `unknown`, and `entitlement.withheld`. A rule the
 * answer drops, or answers twice, is not run and fails the run. That is what
 * turns a parser that silently drops withheld entries (#403), or a service
 * that forgets a rule, into a red run instead of a green one.
 */

/** A differing file, as the service reported it. */
export interface DifferingFile {
  path: string;
  /** What was issued. Absent for a file the service never issued. */
  expected?: string;
  /** What was reported. Absent for an issued file that was not reported. */
  got?: string;
}

export type IntegrityVerdict =
  | "unsafe"
  | "missing"
  | "unknown"
  | "unaccounted"
  | "duplicate";

/** A non-`run` outcome worth reporting, for `check --json`'s `integrity`. */
export interface IntegrityEntry {
  ruleId: string;
  engine?: EngineName;
  verdict: IntegrityVerdict;
  files?: DifferingFile[];
  revisionId?: string;
}

/** What happens to one reported rule. */
export interface RuleDisposition {
  ruleId: string;
  engine: EngineName;
  /** Whether it stays in the snapshot the engines read. */
  run: boolean;
  /** Why it did not run, for `skipped` (runtime) and notices. */
  reason?: string;
}

export interface VerdictPlan {
  dispositions: RuleDisposition[];
  integrity: IntegrityEntry[];
  /** Human notices, one per rule that needs attention. */
  notices: string[];
  /** Each reason that fails the run, besides a plan withhold. */
  failures: string[];
  /** Reported rule ids the service withheld for the plan. */
  withheld: string[];
  /** Present only for an unentitled organization. */
  entitlement?: EntitlementV2;
}

/** The reason a runtime rule the plan withholds did not run. */
export const NOT_IN_PLAN_REASON = "not included in your Taskless plan";

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((entry) => isRecord(entry)) : [];
}

function readFiles(value: unknown): DifferingFile[] {
  return records(value)
    .filter((entry) => typeof entry.path === "string")
    .map((entry) => ({
      path: entry.path as string,
      ...(typeof entry.expected === "string"
        ? { expected: entry.expected }
        : {}),
      ...(typeof entry.got === "string" ? { got: entry.got } : {}),
    }));
}

/** "changed .vale.ini; removed captures/a.yml; added extra.yml" */
export function describeDifferences(files: readonly DifferingFile[]): string {
  if (files.length === 0) return "its files differ from what was issued";
  return files
    .map((file) =>
      file.expected !== undefined && file.got !== undefined
        ? `changed ${file.path}`
        : file.expected === undefined
          ? `added ${file.path}`
          : `removed ${file.path}`
    )
    .join("; ");
}

/** Record a reported rule the answer did not account for: it does not run, and the run fails. */
function unaccounted(plan: VerdictPlan, rule: ReportedRule, why: string): void {
  const { ruleId, engine } = rule;
  plan.dispositions.push({ ruleId, engine, run: false, reason: why });
  plan.integrity.push({ ruleId, engine, verdict: "unaccounted" });
  plan.failures.push(`${engine} rule ${ruleId} did not run: ${why}.`);
}

/**
 * Apply a reconcile response to the rules that were reported.
 *
 * `restoreCommand` renders the command a notice points at, so this stays free
 * of how the CLI was invoked.
 */
export function applyVerdicts(
  reported: readonly ReportedRule[],
  response: unknown,
  restoreCommand: (ruleId: string) => string
): VerdictPlan {
  const body = isRecord(response) ? response : {};
  const entitlement = parseEntitlementV2(body.entitlement);
  const withheldIds = (entitlement?.withheld ?? []).map(
    (entry) => entry.ruleId
  );
  const unknownIds = records(body.unknown)
    .map((entry) => entry.ruleId)
    .filter((id): id is string => typeof id === "string");
  const verdicts = records(body.rules).filter(
    (entry) => typeof entry.ruleId === "string"
  );

  const plan: VerdictPlan = {
    dispositions: [],
    integrity: [],
    notices: [],
    failures: [],
    withheld: [],
    ...(entitlement === undefined ? {} : { entitlement }),
  };

  const reportedIds = new Set(reported.map((rule) => rule.ruleId));

  for (const rule of reported) {
    const { ruleId, engine } = rule;
    const answers = verdicts.filter((entry) => entry.ruleId === ruleId);
    const inUnknown = unknownIds.filter((id) => id === ruleId).length;
    const inWithheld = withheldIds.filter((id) => id === ruleId).length;
    const count = answers.length + inUnknown + inWithheld;

    if (count !== 1) {
      unaccounted(
        plan,
        rule,
        count === 0
          ? "the rule service's answer did not account for it"
          : "the rule service answered for it more than once"
      );
      continue;
    }

    if (inWithheld === 1) {
      plan.withheld.push(ruleId);
      plan.dispositions.push({
        ruleId,
        engine,
        run: false,
        reason: NOT_IN_PLAN_REASON,
      });
      continue;
    }

    if (inUnknown === 1) {
      if (engine === "runtime") {
        const reason =
          "not issued by the rule service for this repository, so it runs only with --dangerously-run-scripts";
        plan.dispositions.push({ ruleId, engine, run: false, reason });
        plan.integrity.push({ ruleId, engine, verdict: "unknown" });
      } else {
        // Locally written static rules are first-class, and every one of them
        // is `unknown`. A notice per rule per run would be noise that trains
        // people to skip notices.
        plan.dispositions.push({ ruleId, engine, run: true });
      }
      continue;
    }

    const answer = answers[0] as Record<string, unknown>;
    // The service says which engine it judged. A different answer means it
    // judged something other than what this directory is, and the verdict
    // cannot be applied to it.
    if (
      typeof answer.engine !== "string" ||
      !isKnownEngine(answer.engine) ||
      answer.engine !== engine
    ) {
      unaccounted(
        plan,
        rule,
        `the rule service judged it as a ${String(answer.engine)} rule, but it is a ${engine} rule here`
      );
      continue;
    }

    switch (answer.verdict) {
      case "run": {
        plan.dispositions.push({ ruleId, engine, run: true });
        break;
      }
      case "unsafe": {
        const files = readFiles(answer.files);
        const changes = describeDifferences(files);
        plan.integrity.push({ ruleId, engine, verdict: "unsafe", files });
        if (engine === "runtime") {
          plan.dispositions.push({
            ruleId,
            engine,
            run: false,
            reason: `edited since Taskless issued it (${changes})`,
          });
          plan.notices.push(
            `runtime rule ${ruleId} was edited since Taskless issued it (${changes}), so it did not run. Run \`${restoreCommand(ruleId)}\` to put back the issued version.`
          );
        } else {
          plan.dispositions.push({
            ruleId,
            engine,
            run: false,
            reason: `edited since Taskless issued it (${changes})`,
          });
          plan.failures.push(
            `${engine} rule ${ruleId} was edited since Taskless issued it (${changes}), so it did not run and \`check\` fails. Run \`${restoreCommand(ruleId)}\` to put back the issued version.`
          );
        }
        break;
      }
      default: {
        // `missing` names a rule that was NOT reported, so it cannot be the
        // answer for one that was; anything else is not a verdict at all.
        unaccounted(
          plan,
          rule,
          `the rule service answered \`${String(answer.verdict)}\`, which is not a verdict for a rule that was reported`
        );
      }
    }
  }

  for (const entry of verdicts) {
    if (entry.verdict !== "missing") continue;
    const ruleId = entry.ruleId as string;
    if (reportedIds.has(ruleId)) continue; // already failed as unaccounted
    const engine =
      typeof entry.engine === "string" && isKnownEngine(entry.engine)
        ? entry.engine
        : undefined;
    const revisionId =
      typeof entry.revisionId === "string" ? entry.revisionId : undefined;
    plan.integrity.push({
      ruleId,
      ...(engine === undefined ? {} : { engine }),
      verdict: "missing",
      ...(revisionId === undefined ? {} : { revisionId }),
    });
    plan.notices.push(
      `${engine ?? "A"} rule ${ruleId} was issued for this repository but is not in .taskless/rules/. Run \`${restoreCommand(ruleId)}\` to bring it back, or ignore this if it was removed on purpose.`
    );
  }

  return plan;
}
