import { canonicalHash } from "../rule-hash";
import { RULES_DIRECTORY } from "../layout";
import type { RestoredRule } from "../../api/restore";
import type { MissingEntry, UnsafeEntry } from "../../api/reconcile";

/** The tree every reported `check.ts` lives under. */
const TASKLESS_DIRECTORY = ".taskless";

/**
 * Deciding what a reconcile verdict can repair, and proving a repair is one.
 *
 * Reconcile returns three verdicts and only two of them are repairable, which
 * the entry shapes already say if you read them as a set:
 *
 * - `unsafe`  `{ file, expected, got }` — we hold bytes that drifted from what
 *   the server blessed. Repairable: the server has the real ones.
 * - `missing` `{ ruleId, file }` — the server expected a rule we never
 *   reported. Repairable, and the only entry that already carries the id
 *   restore is keyed on.
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
 * The rule id inside a reported `check.ts` path.
 *
 * `.taskless/rules/runtime/<id>/check.ts`, matched from the RIGHT so a repo
 * nested under a similarly-named directory cannot shift the segment.
 *
 * This exists only because a reconcile `unsafe` entry does not carry `ruleId`
 * (asked for as N6). It is the weak link in the repair path: the layout has
 * moved twice already, and a move breaks this silently, since a wrong id
 * produces a 404 and a rule that stays unrepaired rather than an error anyone
 * sees. Delete it the moment the entry carries the id.
 */
export function ruleIdFromCheckPath(file: string): string | undefined {
  const segments = file.split("/");
  const checkIndex = segments.lastIndexOf("check.ts");
  if (checkIndex < 1) return undefined;
  const id = segments[checkIndex - 1];
  // The three segments above the id must be `.taskless/<RULES_DIRECTORY>/
  // runtime`, or this is some other `check.ts` and guessing at it would request
  // a rule the service never issued. `rules/runtime/` alone is not enough:
  // plenty of repositories have one, and the id parsed out of it would be a
  // 404 that reads as "the service lost your rule".
  if (
    segments[checkIndex - 2] !== "runtime" ||
    segments[checkIndex - 3] !== RULES_DIRECTORY ||
    segments[checkIndex - 4] !== TASKLESS_DIRECTORY
  ) {
    return undefined;
  }
  return id === undefined || id === "" ? undefined : id;
}

/** Repair targets for the buckets that have something to fetch. */
export function repairTargets(buckets: {
  unsafe: UnsafeEntry[];
  missing: MissingEntry[];
}): { targets: RepairTarget[]; unidentifiable: UnsafeEntry[] } {
  const targets: RepairTarget[] = [];
  const unidentifiable: UnsafeEntry[] = [];

  for (const entry of buckets.unsafe) {
    const ruleId = ruleIdFromCheckPath(entry.file);
    if (ruleId === undefined) {
      unidentifiable.push(entry);
      continue;
    }
    targets.push({ ruleId, file: entry.file, expected: entry.expected });
  }
  for (const entry of buckets.missing) {
    // Already carries the id, so no path parsing and nothing to fail at.
    targets.push({
      ruleId: entry.ruleId,
      file: entry.file,
      expected: undefined,
    });
  }
  return { targets, unidentifiable };
}

/** Why a restored rule was refused, in words a `check` reader can act on. */
export type RepairVerdict =
  | { ok: true; check: string }
  | { ok: false; reason: string };

/** The `check.ts` entry of a restored file set, if it carries exactly one. */
function restoredCheck(rule: RestoredRule): string | undefined {
  const files = (rule as { files?: { path: string; content: string }[] }).files;
  if (!Array.isArray(files)) return undefined;
  const matches = files.filter((file) => file.path === "check.ts");
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

  const claimed = (rule as { signature?: string }).signature;
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
