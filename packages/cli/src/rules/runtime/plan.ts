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
import { discoverRuntimeRules, type RuntimeRule } from "./discover";
import {
  materializeRuntimeRules,
  reportRuntimeChecks,
  selectBlessedRuntimeRules,
  signRuntimeChecks,
} from "./run-set";

/**
 * Deciding WHICH runtime rules may execute, separately from executing them.
 *
 * This lived inside `commands/check.ts` and moved here unchanged so `test` can
 * run a rule's fixtures under the same policy rather than beside it. That is
 * the whole reason for the move: a fixture run executes the same `check.ts`,
 * from the same delivery, under the same signature as a scan, and "it is only
 * running against test data" is a statement about the input rather than about
 * what the program may do. A second implementation of this gate, however
 * faithful on the day it was written, is a bypass waiting to be discovered.
 */

/** A runtime rule that will not run, with why (advisory). */
export interface SkippedRuntimeRule {
  rule: string;
  reason: string;
}

/** The runtime-execution plan resolved from auth state and flags. */
export interface RuntimePlan {
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
      await writeRuleFile(cwd, rule);
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

/**
 * The plan, resolved once and shared by every rule a command reports on.
 *
 * `test` inspects rules one at a time, and planning per rule would send one
 * reconcile per runtime rule for an answer that is the same every time. The
 * plan is therefore memoized on first use and the notices are emitted once,
 * with the whole set of discovered runtime rules reported to reconcile exactly
 * as `check` reports it. A subset would be a different question asked of the
 * service.
 *
 * Lazy rather than eager because most projects hold no runtime rules at all,
 * and a `test` run over a tree of `sg` rules must not reach the network.
 */
export interface RuntimeGate {
  /**
   * The rule as it may be executed, or the reason it may not be.
   *
   * The rule returned is the one the plan blessed, which on the gated path is
   * the materialized copy: the bytes run against a fixture are the bytes the
   * server blessed, not whatever the working tree happens to hold.
   */
  admit(
    ruleId: string
  ): Promise<
    { admitted: true; rule: RuntimeRule } | { admitted: false; reason: string }
  >;
}

/** Build a gate over the runtime rules `cwd` holds. */
export function createRuntimeGate(
  cwd: string,
  options: {
    dangerouslyRunScripts: boolean;
    /** Called once, with the notices `check` prints for the same plan. */
    onNotice?: (message: string) => void;
  }
): RuntimeGate {
  let planned: Promise<RuntimePlan> | undefined;

  const plan = async (): Promise<RuntimePlan> => {
    planned ??= (async () => {
      const discovered = await discoverRuntimeRules(cwd);
      const resolved = await planRuntime(cwd, discovered, {
        anonymous: false,
        dangerouslyRunScripts: options.dangerouslyRunScripts,
      });
      for (const notice of resolved.notices) options.onNotice?.(notice);
      return resolved;
    })();
    return planned;
  };

  return {
    async admit(ruleId) {
      const resolved = await plan();
      const rule = resolved.execute.find(
        (candidate) => candidate.name === ruleId
      );
      if (rule !== undefined) return { admitted: true, rule };

      const skipped = resolved.skipped.find((entry) => entry.rule === ruleId);
      return {
        admitted: false,
        reason:
          skipped?.reason ??
          "it was not discovered as a runnable runtime rule (no capture rules under captures/)",
      };
    },
  };
}
