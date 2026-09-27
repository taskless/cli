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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An upgrade URL is printed as a link the user is invited to follow, so a value
 * that is not an absolute `https:` URL is dropped rather than shown.
 */
function parseUpgradeUrl(value: unknown): string | undefined {
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

/**
 * The warning for a runtime rule written under a plan that will not run it.
 * Shared by `rule create`/`improve` and restore so the sentence cannot drift.
 */
export function notRunOnPlanWarning(
  file: string,
  entitlement: Entitlement
): string {
  return (
    `${file} was written, but runtime rules are not included in your ` +
    `Taskless plan, so it will not run` +
    (entitlement.upgradeUrl === undefined
      ? "."
      : `. Upgrade at ${entitlement.upgradeUrl}`)
  );
}
