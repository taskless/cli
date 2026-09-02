import { canonicalHash } from "../rule-hash";
import type { RestoredRule } from "../../api/restore";
import type { MissingEntry, UnsafeEntry } from "../../api/reconcile";

/**
 * Deciding what a reconcile verdict can repair, and proving a repair is one.
 *
 * Reconcile returns three verdicts and only two of them are repairable, which
 * the entry shapes already say if you read them as a set:
 *
 * - `unsafe`  `{ ruleId, file, expected, got }` — we hold bytes that drifted
 *   from what the server blessed. Repairable: the server has the real ones,
 *   and the entry names which rule to ask for.
 * - `missing` `{ ruleId, file }` — the server expected a rule we never
 *   reported. Repairable, and it names its rule the same way.
 * - `unknown` `{ file }` — we reported a file the service never issued. NOT
 *   repairable, and correctly so: there is nothing on the server to fetch,
 *   which is exactly why the entry carries no rule id. What it needs is an
 *   explanation, not a request.
 *
 * NOTHING REPAIRED RUNS IN THE PASS THAT REPAIRED IT. These functions rewrite
 * the working tree and promote nothing into the current run.
 */

/** The signature envelope this repair must reproduce, and the rule to ask for. */
export interface RepairTarget {
  ruleId: string;
  file: string;
  /**
   * The signature the SERVER already told us it blessed.
   *
   * `undefined` for a `missing` rule, which we do not hold and therefore have
   * no prior expectation for. Present for `unsafe`, and that is the case worth
   * being strict about — see {@link verifyRestoredCheck}.
   */
  expected: string | undefined;
}

/**
 * Repair targets for the buckets that have something to fetch.
 *
 * Both repairable verdicts carry `ruleId`, so the id restore is keyed on is
 * read straight off the entry. Nothing is derived from the reported path: the
 * rules layout has moved twice, and a parse of it would break silently on the
 * next move, requesting a rule id the service never issued and leaving a
 * drifted rule unrepaired and unexecuted with nothing to read.
 */
export function repairTargets(buckets: {
  unsafe: UnsafeEntry[];
  missing: MissingEntry[];
}): RepairTarget[] {
  return [
    ...buckets.unsafe.map((entry) => ({
      ruleId: entry.ruleId,
      file: entry.file,
      expected: entry.expected,
    })),
    ...buckets.missing.map((entry) => ({
      ruleId: entry.ruleId,
      file: entry.file,
      // A missing rule is one we do not hold, so there is no prior signature
      // to hold the restored bytes to.
      expected: undefined,
    })),
  ];
}

/** Why a restored rule was refused, in words a `check` reader can act on. */
export type RepairVerdict =
  | { ok: true; check: string }
  | { ok: false; reason: string };

/** The `check.ts` entry of a restored file set, if it carries exactly one. */
function restoredCheck(rule: RestoredRule): string | undefined {
  // `rule.files` directly: every variant of the union declares it, so a cast
  // here would re-declare a shape the generated types already know and absorb
  // a future schema change instead of failing the build.
  const matches = rule.files.filter((file) => file.path === "check.ts");
  return matches.length === 1 ? matches[0]?.content : undefined;
}

/**
 * Whether a restored rule is the one we asked for, and the one we were owed.
 *
 * THE SIGNATURE CHECKED IS THE ONE RECONCILE ALREADY SENT, not the one the
 * restore response carries. That distinction is the whole guarantee. Verifying
 * the response against its own `signature` field proves only that the service
 * is internally consistent, which it would also be if it handed back a NEWER
 * generation of the rule. That would be an upgrade wearing a repair's clothes,
 * arriving mid-`check`, having never been reviewed by anyone here.
 *
 * With `expected` in hand there is exactly one acceptable answer, and "the
 * service sent something newer" is refused by the same comparison that catches
 * a corrupted transfer.
 *
 * A `missing` rule has no prior expectation, so it falls back to the
 * response's own signature. That is a genuinely weaker check and it is the
 * best available: we are not repairing a rule we hold, we are fetching one we
 * do not have, and there is nothing local to disagree with.
 */
export async function verifyRestoredCheck(
  target: RepairTarget,
  rule: RestoredRule
): Promise<RepairVerdict> {
  const check = restoredCheck(rule);
  if (check === undefined) {
    return {
      ok: false,
      reason: "the restored rule carried no single `check.ts`",
    };
  }

  // Read through the union rather than cast: `signature` is optional on the
  // `sg`/`vale` variants and required on `runtime`, which is the distinction
  // this function exists to enforce, so it must come from the types.
  const claimed = rule.signature;
  if (typeof claimed !== "string" || claimed === "") {
    // The published schema requires this on a runtime rule, so reaching here
    // means the service broke its own contract. Refuse rather than write bytes
    // nothing vouches for.
    return {
      ok: false,
      reason: "the restored runtime rule carried no signature",
    };
  }

  const actual = await canonicalHash(check);
  if (actual !== claimed) {
    return {
      ok: false,
      reason: `the restored bytes do not match the signature the service sent with them (claimed ${claimed}, got ${actual})`,
    };
  }

  if (target.expected !== undefined && actual !== target.expected) {
    return {
      ok: false,
      reason: `the restored bytes are not the ones reconcile blessed — expected ${target.expected}, got ${actual}. Restore repairs a rule, it does not upgrade one`,
    };
  }

  return { ok: true, check };
}
