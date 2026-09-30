import { parseEntitlementV2, type EntitlementV2 } from "../api/entitlement";
import { isRecord } from "../util/is-record";
import type { EngineName } from "./layout";
import { isKnownEngine } from "./layout";
import type { Recovery } from "./recovery-advice";
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
 * | ... `copyOf` | not executed; source named      | not run; FAILS; source named     |
 * | unaccounted  | not executed; fails             | not run; fails                   |
 *
 * **Accounting is computed, not trusted.** Every reported rule must land in
 * exactly one of `rules`, `unknown`, and `entitlement.withheld`. A rule the
 * answer drops, or answers twice, is not run and fails the run. That is what
 * turns a parser that silently drops withheld entries (#403), or a service
 * that forgets a rule, into a red run instead of a green one.
 *
 * **A copy of an issued rule is not a local rule** (taskless/taskless#255).
 * Copying an issued rule to a new directory, loosening it, and deleting the
 * original once produced an `unknown` rule that ran silently plus a `missing`
 * warning. The service now marks such an `unknown` rule with `copyOf`, naming
 * the issued rule whose file it carries. A static copy does not run and fails
 * the run. When its source is also `missing`, the two are one event, a rename,
 * and are reported once: the copy's failure says the source was deleted, and
 * the source gets no separate warning.
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

/** The issued rule an `unknown` rule was copied from, as `check --json` reports it. */
export interface IntegrityCopyOf {
  ruleId: string;
  /** The source revision the copy matches best. */
  revisionId?: string;
  /** Whether the source was answered `missing`: the copy is a rename. */
  sourceMissing: boolean;
}

/** A non-`run` outcome worth reporting, for `check --json`'s `integrity`. */
export interface IntegrityEntry {
  ruleId: string;
  engine?: EngineName;
  verdict: IntegrityVerdict;
  files?: DifferingFile[];
  revisionId?: string;
  /** For an `unknown` rule that carries an issued rule's file. */
  copyOf?: IntegrityCopyOf;
}

/** What happens to one reported rule. */
export interface RuleDisposition {
  ruleId: string;
  engine: EngineName;
  /** Whether it stays in the snapshot the engines read. */
  run: boolean;
  /**
   * What the service answered, for the run's `engine.log`. `run` and a local
   * static rule's `unknown` both run, and the log is where telling them apart
   * matters.
   */
  verdict: "run" | "unsafe" | "unknown" | "withheld" | "unaccounted";
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

function readEngine(value: unknown): EngineName | undefined {
  return typeof value === "string" && isKnownEngine(value) ? value : undefined;
}

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

/** An `unknown` entry's `copyOf`, as far as it could be read. */
type CopyOfRead =
  | { status: "none" }
  | { status: "malformed" }
  | {
      status: "copy";
      ruleId: string;
      revisionId?: string;
      files: DifferingFile[];
    };

/**
 * Read `copyOf` from an `unknown` entry.
 *
 * Absent (or `null`) is a local rule. Present but unreadable is
 * `malformed`, which fails closed: the service only sends `copyOf` when it
 * found issued content, so an unreadable one still says "this is a copy", and
 * running the rule would ignore exactly that.
 */
function readCopyOf(value: unknown): CopyOfRead {
  if (value === undefined || value === null) return { status: "none" };
  if (!isRecord(value) || typeof value.ruleId !== "string" || !value.ruleId) {
    return { status: "malformed" };
  }
  return {
    status: "copy",
    ruleId: value.ruleId,
    ...(typeof value.revisionId === "string"
      ? { revisionId: value.revisionId }
      : {}),
    files: readFiles(value.files),
  };
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
  plan.dispositions.push({
    ruleId,
    engine,
    run: false,
    verdict: "unaccounted",
    reason: why,
  });
  plan.integrity.push({ ruleId, engine, verdict: "unaccounted" });
  plan.failures.push(`${engine} rule ${ruleId} did not run: ${why}.`);
}

/**
 * Apply `copyOf` to an `unknown` rule. The rule never runs. A static copy fails
 * the run; a runtime one is not executed, as any `unknown` runtime rule, and
 * fails nothing. When the source is `missing`, the message describes a rename
 * and points at restoring the source.
 */
function applyCopy(
  plan: VerdictPlan,
  rule: ReportedRule,
  copy: Extract<CopyOfRead, { status: "copy" }>,
  sourceMissing: boolean,
  sourceEngine: EngineName | undefined,
  recovery: Recovery
): void {
  const { ruleId, engine } = rule;
  const source = copy.ruleId;
  const changes =
    copy.files.length === 0 ? "" : ` (${describeDifferences(copy.files)})`;
  const directory = `.taskless/rules/${engine}/${ruleId}/`;
  const what = sourceMissing
    ? `is a copy of Taskless rule ${source}, which was deleted${changes}`
    : `is a copy of Taskless rule ${source}${changes}`;
  const fix = sourceMissing
    ? recovery({
        ruleId: source,
        ...(sourceEngine === undefined ? {} : { engine: sourceEngine }),
        purpose: "put back the issued rule",
        afterwards: `delete ${directory}`,
      })
    : `Delete ${directory}, or rewrite the files it carries from ${source} so it is your own rule.`;

  plan.integrity.push({
    ruleId,
    engine,
    verdict: "unknown",
    files: copy.files,
    copyOf: {
      ruleId: source,
      ...(copy.revisionId === undefined ? {} : { revisionId: copy.revisionId }),
      sourceMissing,
    },
  });

  if (engine === "runtime") {
    plan.dispositions.push({
      ruleId,
      engine,
      run: false,
      verdict: "unknown",
      reason: `a copy of Taskless rule ${source}${changes}, not issued by the rule service for this repository, so it runs only with --dangerously-run-scripts`,
    });
    // A plain runtime copy is already covered by its skip reason. A rename
    // takes the place of the source's `missing` warning, so it is a notice.
    if (sourceMissing) {
      plan.notices.push(
        `runtime rule ${ruleId} ${what}, so it did not run. ${fix}`
      );
    }
    return;
  }

  plan.dispositions.push({
    ruleId,
    engine,
    run: false,
    verdict: "unknown",
    reason: `a copy of Taskless rule ${source}${changes}`,
  });
  plan.failures.push(
    `${engine} rule ${ruleId} ${what}, so it did not run and \`check\` fails. ${fix}`
  );
}

/**
 * Apply a reconcile response to the rules that were reported.
 *
 * `recovery` renders how a notice says to put a rule back, so this stays free
 * of how the CLI was invoked and of what the organization's plan serves.
 */
export function applyVerdicts(
  reported: readonly ReportedRule[],
  response: unknown,
  recovery: Recovery
): VerdictPlan {
  const body = isRecord(response) ? response : {};
  const entitlement = parseEntitlementV2(body.entitlement);
  const withheldIds = (entitlement?.withheld ?? []).map(
    (entry) => entry.ruleId
  );
  const unknownEntries = records(body.unknown).filter(
    (entry) => typeof entry.ruleId === "string"
  );
  const unknownIds = unknownEntries.map((entry) => entry.ruleId as string);
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
  // Rules answered `missing` that were not reported, with their engine when
  // known: a copy naming one of these as its source is a rename.
  const missingIds = new Map(
    verdicts
      .filter((entry) => entry.verdict === "missing")
      .filter((entry) => !reportedIds.has(entry.ruleId as string))
      .map((entry) => [entry.ruleId as string, readEngine(entry.engine)])
  );
  // Sources already reported as half of a rename, so their `missing`
  // notice is not repeated.
  const renamed = new Set<string>();

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
        verdict: "withheld",
        reason: NOT_IN_PLAN_REASON,
      });
      continue;
    }

    if (inUnknown === 1) {
      const entry = unknownEntries.find(
        (candidate) => candidate.ruleId === ruleId
      );
      const copy = readCopyOf(entry?.copyOf);
      if (copy.status === "malformed") {
        unaccounted(
          plan,
          rule,
          "the rule service marked it as a copy of an issued rule without saying which"
        );
        continue;
      }
      if (copy.status === "copy") {
        const sourceMissing = missingIds.has(copy.ruleId);
        if (sourceMissing) renamed.add(copy.ruleId);
        applyCopy(
          plan,
          rule,
          copy,
          sourceMissing,
          missingIds.get(copy.ruleId),
          recovery
        );
        continue;
      }
      if (engine === "runtime") {
        const reason =
          "not issued by the rule service for this repository, so it runs only with --dangerously-run-scripts";
        plan.dispositions.push({
          ruleId,
          engine,
          run: false,
          verdict: "unknown",
          reason,
        });
        plan.integrity.push({ ruleId, engine, verdict: "unknown" });
      } else {
        // Locally written static rules are first-class, and every one of them
        // is `unknown`. A notice per rule per run would be noise that trains
        // people to skip notices.
        plan.dispositions.push({
          ruleId,
          engine,
          run: true,
          verdict: "unknown",
        });
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
        plan.dispositions.push({ ruleId, engine, run: true, verdict: "run" });
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
            verdict: "unsafe",
            reason: `edited since Taskless issued it (${changes})`,
          });
          plan.notices.push(
            `runtime rule ${ruleId} was edited since Taskless issued it (${changes}), so it did not run. ${recovery({ ruleId, engine, purpose: "put back the issued version" })}`
          );
        } else {
          plan.dispositions.push({
            ruleId,
            engine,
            run: false,
            verdict: "unsafe",
            reason: `edited since Taskless issued it (${changes})`,
          });
          plan.failures.push(
            `${engine} rule ${ruleId} was edited since Taskless issued it (${changes}), so it did not run and \`check\` fails. ${recovery({ ruleId, engine, purpose: "put back the issued version" })}`
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
    const engine = readEngine(entry.engine);
    const revisionId =
      typeof entry.revisionId === "string" ? entry.revisionId : undefined;
    plan.integrity.push({
      ruleId,
      ...(engine === undefined ? {} : { engine }),
      verdict: "missing",
      ...(revisionId === undefined ? {} : { revisionId }),
    });
    // Half of a rename: the copy's own message already says it was deleted.
    if (renamed.has(ruleId)) continue;
    plan.notices.push(
      `${engine ?? "A"} rule ${ruleId} was issued for this repository but is not in .taskless/rules/. ${recovery(
        {
          ruleId,
          ...(engine === undefined ? {} : { engine }),
          purpose: "bring it back",
          otherwise: "ignore this if it was removed on purpose",
        }
      )}`
    );
  }

  return plan;
}
