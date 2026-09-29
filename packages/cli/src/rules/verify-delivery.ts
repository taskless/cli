import type { ServedFileSet, ServedRule } from "../api/v2";
import { canonicalHash } from "./rule-hash";
import { RULE_TESTS_DIRECTORY } from "./layout";

/**
 * Checking a served rule against the signatures it arrived with, before any
 * byte of it reaches the disk.
 *
 * v2 serves every file set with `signatures`: one per file of the rule, except
 * its fixtures under `.tests/`, each the algoVersion-1 envelope of that file's
 * content. A signature is a record of what was issued, not permission to run
 * anything (only a reconcile `run` verdict grants that), so what this checks is
 * integrity: that the bytes about to be written are the bytes the service says
 * it issued. A set that fails is refused whole, because a rule directory with
 * one wrong file reconciles as `unsafe` on the next `check` and fails a run
 * two steps from the cause.
 *
 * The two directions are both required. A file with no signature is bytes
 * nothing vouches for; a signature with no file is a rule missing a piece the
 * service thinks it has, which is the inert-rule outcome that exits 0.
 */

/** A served rule that verified, narrowed to its one file set. */
export type VerifiedDelivery =
  | { ok: true; fileSet: ServedFileSet; revisionId: string }
  | { ok: false; reason: string };

/** What the caller already knows the served rule must be. */
export interface DeliveryExpectation {
  /** The rule id that was asked for. */
  ruleId: string;
  /**
   * The revision that must be served, when the caller knows it: the one a
   * generation request produced, or the one a rollback asked for.
   */
  revisionId?: string;
}

function isFixture(path: string): boolean {
  return path.startsWith(`${RULE_TESTS_DIRECTORY}/`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Why a served file set is not the documented shape, or `undefined`. */
function describeMalformedSet(fileSet: unknown): string | undefined {
  if (!isRecord(fileSet))
    return "was served as something other than a file set";
  if (typeof fileSet.id !== "string") return "was served with no string `id`";
  if (typeof fileSet.engine !== "string") {
    return "was served with no string `engine`";
  }
  if (!Array.isArray(fileSet.files)) {
    return "carries a `files` that is not an array";
  }
  for (const [index, file] of fileSet.files.entries()) {
    if (!isRecord(file)) {
      return `carries a \`files[${String(index)}]\` that is not an object`;
    }
    if (typeof file.path !== "string") {
      return `carries a \`files[${String(index)}]\` with no string \`path\``;
    }
    if (typeof file.content !== "string") {
      return `carries \`${file.path}\` with no string \`content\``;
    }
  }
  if (!Array.isArray(fileSet.signatures)) {
    return "carries a `signatures` that is not an array";
  }
  for (const [index, entry] of fileSet.signatures.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      typeof entry.signature !== "string"
    ) {
      return `carries a \`signatures[${String(index)}]\` that is not a { path, signature }`;
    }
  }
  return undefined;
}

/**
 * Verify a served rule. Never throws for a payload problem; every refusal is a
 * reason naming the rule and what was wrong.
 */
export async function verifyServedRule(
  served: ServedRule,
  expected: DeliveryExpectation
): Promise<VerifiedDelivery> {
  const { ruleId } = expected;

  if (served.ruleId !== ruleId) {
    return {
      ok: false,
      reason: `the service answered for rule ${served.ruleId}, not ${ruleId}`,
    };
  }
  if (
    expected.revisionId !== undefined &&
    served.revisionId !== expected.revisionId
  ) {
    return {
      ok: false,
      reason: `rule ${ruleId} was served at revision ${served.revisionId}, not ${expected.revisionId}`,
    };
  }
  if (served.rules.length !== 1) {
    return {
      ok: false,
      reason: `rule ${ruleId} was served as ${String(served.rules.length)} file sets; exactly one is expected`,
    };
  }
  const fileSet = served.rules[0] as ServedFileSet;
  // The response is typed, but it arrived over a network and is checked
  // before anything reads it field by field. A defect is named by the field it
  // is in, so whoever debugs it looks in the right place.
  const malformed = describeMalformedSet(fileSet);
  if (malformed !== undefined) {
    return { ok: false, reason: `rule ${ruleId} ${malformed}` };
  }
  if (fileSet.id !== ruleId) {
    return {
      ok: false,
      reason: `rule ${ruleId} was served with a file set for ${fileSet.id}`,
    };
  }

  const signatures = new Map<string, string>();
  for (const entry of fileSet.signatures) {
    if (signatures.has(entry.path)) {
      return {
        ok: false,
        reason: `rule ${ruleId} carries two signatures for ${entry.path}`,
      };
    }
    signatures.set(entry.path, entry.signature);
  }

  const delivered = new Set(fileSet.files.map((file) => file.path));
  for (const path of signatures.keys()) {
    if (!delivered.has(path)) {
      return {
        ok: false,
        reason: `rule ${ruleId} carries a signature for ${path} but no such file`,
      };
    }
    if (isFixture(path)) {
      return {
        ok: false,
        reason: `rule ${ruleId} carries a signature for the fixture ${path}; fixtures are never signed`,
      };
    }
  }

  for (const file of fileSet.files) {
    if (isFixture(file.path)) continue;
    const claimed = signatures.get(file.path);
    if (claimed === undefined) {
      return {
        ok: false,
        reason: `rule ${ruleId} carries ${file.path} with no signature`,
      };
    }
    const actual = await canonicalHash(file.content);
    if (actual !== claimed) {
      return {
        ok: false,
        reason: `rule ${ruleId} carries ${file.path} whose bytes do not match its signature (claimed ${claimed}, got ${actual})`,
      };
    }
  }

  if (fileSet.engine === "runtime") {
    const checkSignature = signatures.get("check.ts");
    if (checkSignature === undefined || fileSet.signature !== checkSignature) {
      return {
        ok: false,
        reason: `runtime rule ${ruleId}'s signature does not equal its check.ts entry`,
      };
    }
  }

  return { ok: true, fileSet, revisionId: served.revisionId };
}
