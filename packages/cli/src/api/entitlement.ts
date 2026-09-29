/**
 * The runtime-signatures entitlement the service attaches to reconcile (always)
 * and to a served runtime file set (taskless/taskless#207, #229).
 *
 * A withheld rule is absent from the verdicts, so a CLI that ignored this
 * object would skip it like any other and `check` would go green while the
 * rule it was supposed to be running has stopped. Reading it is what lets
 * `check` tell "the server declined to run this for your plan" apart from
 * drift, and fail.
 */

import { isRecord } from "../util/is-record";

/**
 * An upgrade URL is printed as a link the user is invited to follow, so a value
 * that is not an absolute `https:` URL is dropped rather than shown.
 */
export function parseUpgradeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** A runtime rule the v2 service withheld for entitlement, not for tampering. */
export interface WithheldRule {
  ruleId: string;
  /** The revision it matched exactly. Kept for reporting; never a join key. */
  revisionId?: string;
}

/** A v2 entitlement outcome. As with v1, only the unentitled case is represented. */
export interface EntitlementV2 {
  runtimeSignatures: false;
  reason?: string;
  /** Present only when it parsed as an absolute `https:` URL. */
  upgradeUrl?: string;
  /** Always an array; empty on served file sets, which never carry it. */
  withheld: WithheldRule[];
}

/**
 * Normalize an untrusted v2 `entitlement` field.
 *
 * v2 names withheld RULES, `{ ruleId, revisionId }`, where v1 named files. The
 * v1 parser dropped any entry without a string `file`, so it would have read a
 * v2 body as withholding nothing, and `check` would have passed on a plan that
 * ran nothing (taskless/cli#403). This parser keys on `ruleId` alone and keeps
 * an entry whatever else it lacks. An entry
 * with no `ruleId` cannot be joined to anything reported and is dropped here,
 * which is safe only because `check` separately fails any reported rule the
 * response did not account for.
 */
export function parseEntitlementV2(value: unknown): EntitlementV2 | undefined {
  if (!isRecord(value) || value.runtimeSignatures !== false) return undefined;

  const withheld: WithheldRule[] = [];
  if (Array.isArray(value.withheld)) {
    for (const entry of value.withheld) {
      if (!isRecord(entry) || typeof entry.ruleId !== "string") continue;
      withheld.push({
        ruleId: entry.ruleId,
        ...(typeof entry.revisionId === "string"
          ? { revisionId: entry.revisionId }
          : {}),
      });
    }
  }

  const upgradeUrl = parseUpgradeUrl(value.upgradeUrl);
  return {
    runtimeSignatures: false,
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    ...(upgradeUrl === undefined ? {} : { upgradeUrl }),
    withheld,
  };
}

/**
 * Why a runtime rule just written will not run. Shared by `rule create`,
 * `rule improve`, and restore, which each name the rule their own way, so the
 * explanation cannot drift between them.
 */
export function notRunOnPlanSentence(entitlement: {
  upgradeUrl?: string;
}): string {
  // The URL ends the sentence with no trailing period, so copying it from a
  // terminal does not copy a `.` into the address.
  return (
    "It will not run: runtime rules are not included in your Taskless plan" +
    (entitlement.upgradeUrl === undefined
      ? "."
      : `. Upgrade at ${entitlement.upgradeUrl}`)
  );
}
