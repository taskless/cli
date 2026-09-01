import { describe, expect, it } from "vitest";

import { canonicalHash } from "../src/rules/rule-hash";
import {
  repairTargets,
  ruleIdFromCheckPath,
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

  it("takes a missing entry's id rather than parsing its path", () => {
    // The path here would parse to `x`; the entry says `evals-def67890`, and
    // the entry wins. Parsing is the fallback for `unsafe` only.
    const { targets } = repairTargets({
      unsafe: [],
      missing: [
        {
          ruleId: "evals-def67890",
          file: ".taskless/rules/runtime/x/check.ts",
        },
      ],
    });
    expect(targets[0]?.ruleId).toBe("evals-def67890");
  });

  it("reports an unsafe entry whose path yields no rule id", () => {
    // Rather than requesting a guessed id. The service never issued a rule
    // called `src`, and asking for one turns a repairable state into a 404.
    const { targets, unidentifiable } = repairTargets({
      unsafe: [{ file: "src/check.ts", expected: "1;h=sha-256;d=a", got: "b" }],
      missing: [],
    });
    expect(targets).toHaveLength(0);
    expect(unidentifiable).toHaveLength(1);
  });
});

describe("reading a rule id out of a check path", () => {
  it.each([
    [".taskless/rules/runtime/logs-abc12345/check.ts", "logs-abc12345"],
    // A repo nested under a directory of the same name: matched from the right.
    ["vendor/.taskless/rules/runtime/logs-abc12345/check.ts", "logs-abc12345"],
  ])("reads %s as %s", (file, expected) => {
    expect(ruleIdFromCheckPath(file)).toBe(expected);
  });

  it.each([
    ["a check outside the rules tree", "src/check.ts"],
    ["the wrong engine directory", ".taskless/rules/sg/logs-abc/check.ts"],
    ["a differently rooted tree", "other/rules/runtime/logs-abc/check.ts"],
    ["no check.ts at all", ".taskless/rules/runtime/logs-abc/rule.yml"],
  ])("refuses %s", (_label, file) => {
    expect(ruleIdFromCheckPath(file)).toBeUndefined();
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
