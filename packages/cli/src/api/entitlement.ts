/**
 * The runtime-signatures entitlement the service attaches to reconcile,
 * restore, and request retrieval (taskless/taskless#207).
 *
 * The object is additive: the four reconcile buckets mean what they always
 * meant, and a CLI that ignores it never executes a withheld rule. What such a
 * CLI does get wrong is the exit code. A withheld rule is absent from `run`, so
 * it is skipped like any other, and `check` goes green while the rule it was
 * supposed to be running has stopped. Reading this object is what lets `check`
 * tell "the server declined to run this for your plan" apart from drift.
 */

import { isRecord } from "../util/is-record";

/** A reported file the service withheld for entitlement, not for tampering. */
export interface WithheldEntry {
  ruleId?: string;
  file: string;
}

/**
 * An entitlement outcome. Only the unentitled case is represented: an absent,
 * malformed, or `runtimeSignatures: true` object normalizes to `undefined`,
 * because none of them asks the CLI to do anything different.
 */
export interface Entitlement {
  runtimeSignatures: false;
  reason?: string;
  /** Present only when it parsed as an absolute `https:` URL. */
  upgradeUrl?: string;
  /** Always an array; empty on restore/retrieval, which never carry it. */
  withheld: WithheldEntry[];
}

/**
 * A generated response type that may also carry `entitlement`.
 *
 * The service adds the field (taskless/taskless#207) before the vendored
 * schema does, so the CLI ships assuming it MIGHT be there rather than waiting
 * on the deploy. `unknown`, not `Entitlement`: the field is untrusted until it
 * has been through {@link parseEntitlement}. When the schema carries it, this
 * collapses to the generated type and the wrapper can go.
 */
export type MayCarryEntitlement<T> = T & { entitlement?: unknown };

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

/**
 * Normalize an untrusted `entitlement` field. Returns `undefined` unless
 * `runtimeSignatures` is exactly `false`, so a service that predates the field
 * (or sends `true`) leaves every caller on its existing path.
 */
export function parseEntitlement(value: unknown): Entitlement | undefined {
  if (!isRecord(value) || value.runtimeSignatures !== false) return undefined;

  const withheld: WithheldEntry[] = [];
  if (Array.isArray(value.withheld)) {
    for (const entry of value.withheld) {
      // The file is the join key back to a local rule (the entry carries no
      // signature), and the schema requires it. An entry without one broke
      // that contract and is dropped, not guessed at. An entry that HAS a file
      // matching nothing local is kept: it still fails the run.
      if (!isRecord(entry) || typeof entry.file !== "string") continue;
      withheld.push({
        file: entry.file,
        ...(typeof entry.ruleId === "string" ? { ruleId: entry.ruleId } : {}),
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
 * v1 {@link parseEntitlement} drops any entry without a string `file`, so
 * handing it a v2 body drops every withheld rule, `withheld` comes back empty,
 * and `check` passes on a plan that ran nothing (taskless/cli#403). This parser
 * keys on `ruleId` alone and keeps an entry whatever else it lacks. An entry
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
export function notRunOnPlanSentence(
  entitlement: Pick<Entitlement, "upgradeUrl">
): string {
  // The URL ends the sentence with no trailing period, so copying it from a
  // terminal does not copy a `.` into the address.
  return (
    "It will not run: runtime rules are not included in your Taskless plan" +
    (entitlement.upgradeUrl === undefined
      ? "."
      : `. Upgrade at ${entitlement.upgradeUrl}`)
  );
}
