import { describe, expect, it } from "vitest";

import { canonicalHash } from "../src/rules/rule-hash";
import {
  repairTargets,
  verifyRestoredCheck,
  type RepairTarget,
} from "../src/rules/runtime/repair";
import type { RestoredRule } from "../src/api/restore";

const CHECK = "export default async () => [];\n";
const TAMPERED = "export default async () => [{ file: 'x' }];\n";

/** A restored runtime rule carrying `check.ts` and a signature over it. */
async function restored(
  content: string,
  signature?: string
): Promise<RestoredRule> {
  return {
    id: "logs-abc12345",
    engine: "runtime",
    files: [{ path: "check.ts", content }],
    signature: signature ?? (await canonicalHash(content)),
  } as unknown as RestoredRule;
}

describe("which reconcile verdicts can be repaired", () => {
  it("routes unsafe and missing, and never unknown", () => {
    // `unknown` is not in the input type at all, and that is the point: there
    // is nothing on the server to fetch for a file it never issued, which is
    // why its entry carries no rule id to fetch it by.
    const { targets } = repairTargets({
      unsafe: [
        {
          ruleId: "logs-abc12345",
          file: ".taskless/rules/runtime/logs-abc12345/check.ts",
          expected: "1;h=sha-256;d=aaa",
          got: "1;h=sha-256;d=bbb",
        },
      ],
      missing: [
        {
          ruleId: "evals-def67890",
          file: ".taskless/rules/runtime/x/check.ts",
        },
      ],
    });

    expect(targets).toHaveLength(2);
    expect(targets[0]?.ruleId).toBe("logs-abc12345");
    expect(targets[0]?.expected).toBe("1;h=sha-256;d=aaa");
    // A missing rule is one we do not hold, so there is no prior expectation.
    expect(targets[1]?.ruleId).toBe("evals-def67890");
    expect(targets[1]?.expected).toBeUndefined();
  });

  it.each([["unsafe" as const], ["missing" as const]])(
    "takes a %s entry's id rather than parsing its path",
    (bucket) => {
      // The path parses to `x`; the entry says `evals-def67890`. The entry wins,
      // and nothing reads the path at all. A path-parsing implementation asks
      // restore for `x`, gets a 404, and leaves the rule unrepaired in silence,
      // which is the failure this assertion exists to catch.
      const entry = {
        ruleId: "evals-def67890",
        file: ".taskless/rules/runtime/x/check.ts",
      };
      const { targets } = repairTargets({
        unsafe:
          bucket === "unsafe"
            ? [{ ...entry, expected: "1;h=sha-256;d=aaa", got: "b" }]
            : [],
        missing: bucket === "missing" ? [entry] : [],
      });
      expect(targets).toHaveLength(1);
      expect(targets[0]?.ruleId).toBe("evals-def67890");
    }
  );

  it("identifies an unsafe entry whose file sits outside the rules tree", () => {
    // Nothing about the reported path decides anything now, so a rule held
    // somewhere the layout does not describe is still repairable. Under path
    // parsing this entry was unidentifiable and dropped.
    const { targets } = repairTargets({
      unsafe: [
        {
          ruleId: "logs-abc12345",
          file: "src/check.ts",
          expected: "1;h=sha-256;d=a",
          got: "b",
        },
      ],
      missing: [],
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]?.ruleId).toBe("logs-abc12345");
  });

  // The published schema requires `ruleId` on both repairable verdicts, and
  // `reconcile` decodes with a cast rather than a schema, so the `string` type
  // is what the service PROMISES rather than what arrived. A rollback or a
  // canary that breaks that promise must not become a request: without the
  // guard `restoreRule` is handed `undefined` and asks the service for
  // `/cli/api/request/undefined/restore`, which cannot succeed and says
  // nothing when it fails.
  describe.each([["unsafe" as const], ["missing" as const]])(
    "a %s entry that names no rule",
    (bucket) => {
      const plan = (ruleId?: unknown) => {
        const entry = { ruleId, file: `.taskless/rules/runtime/x/check.ts` };
        return repairTargets({
          unsafe:
            bucket === "unsafe"
              ? [{ ...entry, expected: "1;h=sha-256;d=a", got: "b" }]
              : [],
          missing: bucket === "missing" ? [entry] : [],
        } as unknown as Parameters<typeof repairTargets>[0]);
      };

      it.each([
        ["absent", undefined],
        ["empty", ""],
        ["whitespace", "   "],
      ])("is not requested when its id is %s", (_label, ruleId) => {
        const { targets, unidentified } = plan(ruleId);
        // Nothing to ask for: no target means no request built from a rule id
        // nobody supplied.
        expect(targets).toEqual([]);
        // And it is said out loud, so the skip is not a silent pass.
        expect(unidentified).toEqual([
          { file: ".taskless/rules/runtime/x/check.ts" },
        ]);
      });

      it("is not rescued by parsing its path", () => {
        // The path contains `x`, which the deleted fallback would have taken.
        // The id is reported as absent, not invented.
        const { targets } = plan();
        expect(targets).toEqual([]);
      });
    }
  );

  it("keeps identified entries when another names no rule", () => {
    // One bad entry withholds itself, not the rules beside it.
    const { targets, unidentified } = repairTargets({
      unsafe: [
        {
          ruleId: "logs-abc12345",
          file: ".taskless/rules/runtime/logs-abc12345/check.ts",
          expected: "1;h=sha-256;d=a",
          got: "b",
        },
        { file: "src/orphan.ts", expected: "1;h=sha-256;d=c", got: "d" },
      ],
      missing: [{ ruleId: "evals-def67890", file: "src/present.ts" }],
    } as unknown as Parameters<typeof repairTargets>[0]);

    expect(targets.map((target) => target.ruleId)).toEqual([
      "logs-abc12345",
      "evals-def67890",
    ]);
    expect(unidentified).toEqual([{ file: "src/orphan.ts" }]);
  });
});

describe("verifying restored bytes", () => {
  const unsafeTarget = async (): Promise<RepairTarget> => ({
    ruleId: "logs-abc12345",
    file: ".taskless/rules/runtime/logs-abc12345/check.ts",
    expected: await canonicalHash(CHECK),
  });

  it("accepts the bytes reconcile blessed", async () => {
    const verdict = await verifyRestoredCheck(
      await unsafeTarget(),
      await restored(CHECK)
    );
    expect(verdict.ok).toBe(true);
  });

  /**
   * The property task 6.4 asks for, and the reason `expected` is checked at
   * all: restore repairs, it does not upgrade.
   */
  it("refuses bytes that are newer than the ones reconcile blessed", async () => {
    // Internally consistent — the service signed exactly what it sent — and
    // still refused, because it is not what we were owed. Verifying only the
    // response against itself would install this silently, mid-`check`.
    const newer = await restored(TAMPERED);
    const verdict = await verifyRestoredCheck(await unsafeTarget(), newer);

    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(
      /not the ones reconcile blessed/
    );
    expect(verdict.ok === false && verdict.reason).toMatch(/does not upgrade/);
  });

  it("refuses bytes that do not match the signature sent with them", async () => {
    // A corrupted or substituted transfer: the claim and the content disagree.
    const inconsistent = await restored(TAMPERED, await canonicalHash(CHECK));
    const verdict = await verifyRestoredCheck(
      await unsafeTarget(),
      inconsistent
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(
      /do not match the signature/
    );
  });

  it("refuses a runtime rule the service returned without a signature", async () => {
    // The published schema requires it, so this means the service broke its
    // own contract. Writing unvouched-for bytes is not the way to find out.
    const unsigned = {
      id: "logs-abc12345",
      engine: "runtime",
      files: [{ path: "check.ts", content: CHECK }],
    } as unknown as RestoredRule;

    const verdict = await verifyRestoredCheck(await unsafeTarget(), unsigned);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/no signature/);
  });

  it.each([
    ["no check.ts", []],
    [
      "two check.ts entries",
      [
        { path: "check.ts", content: CHECK },
        { path: "check.ts", content: TAMPERED },
      ],
    ],
  ])("refuses a restored set with %s", async (_label, files) => {
    const rule = {
      id: "logs-abc12345",
      engine: "runtime",
      files,
      signature: await canonicalHash(CHECK),
    } as unknown as RestoredRule;

    const verdict = await verifyRestoredCheck(await unsafeTarget(), rule);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(
      /single `check\.ts`/
    );
  });

  it("falls back to the response signature for a missing rule", async () => {
    // Nothing local to disagree with, so the weaker check is the only one
    // available. Stated in the module rather than left as an inconsistency.
    const verdict = await verifyRestoredCheck(
      {
        ruleId: "evals-def67890",
        file: ".taskless/rules/runtime/evals-def67890/check.ts",
        expected: undefined,
      },
      await restored(TAMPERED)
    );
    expect(verdict.ok).toBe(true);
  });
});
