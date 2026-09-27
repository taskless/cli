import { getToken } from "../../auth/token";
import { resolveOrgSubject } from "../../auth/org";
import { resolveRepositoryUrl } from "../../util/git-remote";
import { getCliPrefix } from "../../util/package-manager";
import { reconcile } from "../../api/reconcile";
import type { ReconcileResponse } from "../../api/reconcile";
import { restoreRule } from "../../api/restore";
import { writeRuleFile } from "../files";
import { PurgeIncompleteError } from "../deliver";
import { repairTargets, verifyRestoredCheck } from "./repair";
import { RUN_SCRIPTS_WARNING } from "./harness";
import { type RuntimeRule } from "./discover";
import {
  materializeRuntimeRules,
  reportedCheckPath,
  reportRuntimeChecks,
  selectBlessedRuntimeRules,
  signRuntimeChecks,
} from "./run-set";

/**
 * Deciding WHICH runtime rules may execute during a `check`, separately from
 * executing them.
 *
 * `check` is the only caller and the only command that needs this. It executes
 * rules as a SIDE EFFECT of scanning a repository — nobody asked for code to
 * run — so a reconcile stands between the scan and the execution, and every
 * unverified path skips rather than fails.
 *
 * `test` deliberately does not come through here. It runs a rule's fixtures
 * because the user typed `test`, so the verb is the consent and
 * `--dangerously-run-scripts` is its whole gate; see the runtime branch of
 * `rules/inspect.ts`. That is stricter than sharing this module, not looser:
 * nothing runs under `test` that would not have run before, and a blessed rule
 * that used to run there without the flag now needs it.
 *
 * It lived inside `commands/check.ts` and moved here for a reason that has
 * since evaporated (sharing the gate with `test`). It stays because a second
 * reason holds on its own: this is policy, `commands/check.ts` is argument
 * parsing and rendering, and `repairWithheldRules` below is a long piece of
 * recovery logic that a command file has no business carrying.
 */

/** A runtime rule that will not run, with why (advisory). */
export interface SkippedRuntimeRule {
  rule: string;
  reason: string;
}

/**
 * The service declined to run runtime rules for this organization's plan.
 *
 * Unlike every other skip, this one fails `check`. The degrade paths skip
 * because the CLI could not ask; this skip is the answer to a question it did
 * ask, and it will be the same answer on every run until someone acts on it.
 */
export interface PlanEntitlement {
  runtimeSignatures: false;
  reason?: string;
  upgradeUrl?: string;
  /**
   * Local rule names the service withheld, plus the reported path of any
   * withheld entry that matched no local rule. Non-empty means `check` fails.
   */
  withheld: string[];
}

/** The runtime-execution plan resolved from auth state and flags. */
export interface RuntimePlan {
  /** Rules to execute — materialized when gated, live under `--dangerously-run-scripts`. */
  execute: RuntimeRule[];
  /** Rules that will not run, with a reason. */
  skipped: SkippedRuntimeRule[];
  /** Human-only notices about the runtime disposition. */
  notices: string[];
  /** Present only when reconcile answered for a plan without runtime signatures. */
  entitlement?: PlanEntitlement;
}

/** The skip reason for a rule withheld because the plan lacks runtime rules. */
export const NOT_IN_PLAN_REASON = "not included in your Taskless plan";

/** Skip every runtime rule with a shared reason (an unverified path). */
function skipAllRuntime(rules: RuntimeRule[], reason: string): RuntimePlan {
  return {
    execute: [],
    skipped: rules.map((rule) => ({ rule: rule.name, reason })),
    notices: [],
  };
}

/**
 * The rules that were blessed but are not going to run, so a drop between the
 * two is reported rather than silent.
 *
 * `execute` is whatever re-discovery under `.taskless/.run/` returns, which is
 * a DIFFERENT question from what was blessed. A rule can be blessed and then
 * vanish: a `captures/` symlink that resolves in the working tree can dangle
 * once copied, a file can fail to materialize, and re-discovery then classifies
 * the rule as "not a runtime rule" and drops it.
 *
 * Without this accounting such a rule is in neither list. Not in `execute`
 * because it was dropped, and not in `withheld` because the server did bless
 * it, so `check` exits 0 having said nothing and the user believes their
 * runtime rule ran.
 *
 * Deliberately keyed on the difference rather than on any particular cause.
 * Reading an unreadable `captures/` as absence was one route in and is fixed at
 * its source, but a dangling symlink reports `ENOENT`, which is genuinely
 * "absent" and correctly stays absent there. Only comparing the two sets
 * catches that, and whatever the next route turns out to be.
 */
export function accountForDroppedRules(
  blessed: readonly RuntimeRule[],
  execute: readonly RuntimeRule[]
): SkippedRuntimeRule[] {
  const executed = new Set(execute.map((rule) => rule.name));
  return blessed
    .filter((rule) => !executed.has(rule.name))
    .map((rule) => ({
      rule: rule.name,
      reason: "blessed by the server but missing after materialization",
    }));
}

/**
 * Decide which runtime rules run. A runtime rule's `check.ts` is arbitrary code
 * execution, so it runs only when its signature is server-validated (an
 * authenticated reconcile that returns it in `run`) or `--dangerously-run-scripts`
 * is set. Every unverified path — anonymous, logged out, no remote, or a
 * reconcile that cannot complete — skips runtime rules without failing.
 */
export async function planRuntime(
  cwd: string,
  discovered: RuntimeRule[],
  options: { anonymous: boolean; dangerouslyRunScripts: boolean }
): Promise<RuntimePlan> {
  if (discovered.length === 0) return { execute: [], skipped: [], notices: [] };

  if (options.dangerouslyRunScripts) {
    return {
      execute: discovered,
      skipped: [],
      notices: [RUN_SCRIPTS_WARNING],
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
  // Joined by reported path, since a withheld entry carries no signature. A
  // withheld rule is split out of the generic "not blessed" skips so it is
  // never described as drift: nothing about its bytes is wrong.
  const entitlement = outcome.result.entitlement;
  const withheldFiles = new Set(
    (entitlement?.withheld ?? []).map((entry) => entry.file)
  );
  const planWithheld = withheld.filter((rule) =>
    withheldFiles.has(reportedCheckPath(cwd, rule))
  );
  const notBlessed = withheld.filter((rule) => !planWithheld.includes(rule));
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
  //
  // A file withheld for the plan is never sent to restore. The service keeps
  // it out of `unsafe` and `missing` already; this holds if it ever does not,
  // because restoring bytes the plan will not run fixes nothing and says the
  // opposite.
  const repair = await repairWithheldRules(cwd, token, {
    repositoryUrl,
    result: {
      ...outcome.result,
      unsafe: outcome.result.unsafe.filter(
        (entry) => !withheldFiles.has(entry.file)
      ),
      missing: outcome.result.missing.filter(
        (entry) => !withheldFiles.has(entry.file)
      ),
    },
  });

  // A rule can be blessed and then vanish before it is executed. `execute` is
  // whatever re-discovery under `.taskless/.run/` returns, and that is a
  // different question from what was blessed: a `captures/` symlink that
  // resolves in the working tree can dangle once copied, a file can fail to
  // materialize, and re-discovery then classifies the rule as "not a runtime
  // rule" and drops it.
  //
  // Without this, such a rule is in neither list. It is not in `execute`
  // because it was dropped, and not in `withheld` because the server did bless
  // it, so `check` exits 0 having said nothing and the user believes it ran.
  // Accounting for the difference is what makes the drop reportable at all,
  // independently of which specific route caused it.
  const droppedSkips = accountForDroppedRules(blessed, execute);

  const planEntitlement =
    entitlement === undefined
      ? undefined
      : summarizeEntitlement(cwd, entitlement, planWithheld);

  return {
    execute,
    skipped: [
      ...unreadableSkips,
      ...notBlessed.map((rule) => ({
        rule: rule.name,
        reason: "not blessed by the server (unsafe / unknown / drift)",
      })),
      ...planWithheld.map((rule) => ({
        rule: rule.name,
        reason: NOT_IN_PLAN_REASON,
      })),
      ...droppedSkips,
    ],
    notices: [
      ...(planEntitlement === undefined || planEntitlement.withheld.length === 0
        ? []
        : [withheldNotice(planEntitlement)]),
      ...repair.notices,
    ],
    ...(planEntitlement === undefined ? {} : { entitlement: planEntitlement }),
  };
}

/**
 * Name what the service withheld, locally where possible.
 *
 * A withheld entry whose file matches no local rule is kept by its reported
 * path rather than dropped. The service said something will not run, and the
 * CLI failing to attribute it is not a reason for the run to go green.
 */
function summarizeEntitlement(
  cwd: string,
  entitlement: NonNullable<ReconcileResponse["entitlement"]>,
  planWithheld: RuntimeRule[]
): PlanEntitlement {
  const matched = new Set(
    planWithheld.map((rule) => reportedCheckPath(cwd, rule))
  );
  const unmatched = entitlement.withheld
    .map((entry) => entry.file)
    .filter((file) => !matched.has(file));
  return {
    runtimeSignatures: false,
    ...(entitlement.reason === undefined ? {} : { reason: entitlement.reason }),
    ...(entitlement.upgradeUrl === undefined
      ? {}
      : { upgradeUrl: entitlement.upgradeUrl }),
    withheld: [...planWithheld.map((rule) => rule.name), ...unmatched],
  };
}

/** The one notice a withheld run prints, so the upgrade URL appears once. */
function withheldNotice(entitlement: PlanEntitlement): string {
  const count = entitlement.withheld.length;
  return (
    `${String(count)} runtime ${count === 1 ? "rule was" : "rules were"} ` +
    `withheld because runtime rules are not included in your Taskless plan` +
    (entitlement.reason === undefined ? "" : ` (${entitlement.reason})`) +
    `: ${entitlement.withheld.join(", ")}. \`check\` fails until they can run` +
    (entitlement.upgradeUrl === undefined
      ? "."
      : `. Upgrade at ${entitlement.upgradeUrl}`)
  );
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

  const { targets, unidentified } = repairTargets(input.result);

  // A repairable entry that named no rule. The service's own schema requires
  // one, so reaching here means it broke that contract — and the entry is
  // skipped rather than guessed at, because a rule left unrepaired stays
  // withheld, which is safe, while a request built from a missing id asks for
  // a rule nobody named and fails in a way nobody reads.
  for (const entry of unidentified) {
    notices.push(
      `${entry.file} needs to be restored, but the rule service did not say ` +
        `which rule it belongs to, so it could not be requested and will not ` +
        `run.`
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
      // A restored rule missing its fixtures is still the blessed bytes and is
      // still worth writing; the notice rides along with the repair's own.
      await writeRuleFile(cwd, rule, (message) => notices.push(message));
    } catch (error) {
      // A failed WRITE and a failed CLEANUP ask the reader for opposite
      // things, and saying "could not be written" for both is worse than
      // saying nothing: the blessed bytes are on disk in the second case, so
      // a reader acting on it re-runs a repair that already succeeded, or
      // decides the rule is unrepaired and edits it by hand.
      if (error instanceof PurgeIncompleteError) {
        notices.push(
          `${target.file} was rewritten with the bytes the service blessed, ` +
            `but ${String(error.failures.length)} stale ` +
            `${error.failures.length === 1 ? "entry" : "entries"} could not ` +
            `be removed and an engine still reads ` +
            `${error.failures.length === 1 ? "it" : "them"}: ` +
            `${error.failures.join(", ")}.`
        );
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      notices.push(`${target.file} could not be written (${message}).`);
      continue;
    }
    // Now says what the DIRECTORY contains, not just what was written. The
    // delivered set is authoritative (see `writeDeliveredFileSet`), so a file
    // the set does not name — a stray capture beside the rule, which reconcile
    // never reported because only `check.ts` is signed — is gone rather than
    // left in place still changing what the rule matches. The one exception is
    // `.tests/`, which is named here rather than glossed: fixtures are data no
    // engine reads, they are kept, and a reader should not have to infer that
    // from silence.
    notices.push(
      `${target.file} was restored: its rule directory now holds exactly the ` +
        `files the service delivered, apart from test fixtures under ` +
        `\`.tests/\`, which are left alone. It does not run in this pass; the ` +
        `next \`check\` reports the repaired signature and is blessed through ` +
        `the ordinary path.`
    );
  }

  return { notices };
}
