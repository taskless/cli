import { describe, expect, it } from "vitest";

import { parseEntitlement } from "../src/api/entitlement";

const UPGRADE = "https://app.taskless.io/o/acme/upgrade?from=reconcile";

describe("parseEntitlement", () => {
  it("is undefined when the field is absent, so an older service changes nothing", () => {
    const body: { entitlement?: unknown } = {};
    expect(parseEntitlement(body.entitlement)).toBeUndefined();
  });

  it("is undefined for an entitled organization", () => {
    expect(parseEntitlement({ runtimeSignatures: true })).toBeUndefined();
  });

  it("is undefined unless runtimeSignatures is exactly false", () => {
    for (const value of [null, "false", 0, [], { runtimeSignatures: "no" }]) {
      expect(parseEntitlement(value)).toBeUndefined();
    }
  });

  it("reads reason, upgradeUrl, and withheld for an unentitled organization", () => {
    expect(
      parseEntitlement({
        runtimeSignatures: false,
        reason: "RUNTIME_SIGNATURES_NOT_IN_PLAN",
        upgradeUrl: UPGRADE,
        withheld: [
          { ruleId: "r-1", file: ".taskless/rules/runtime/a/check.ts" },
        ],
      })
    ).toEqual({
      runtimeSignatures: false,
      reason: "RUNTIME_SIGNATURES_NOT_IN_PLAN",
      upgradeUrl: UPGRADE,
      withheld: [{ ruleId: "r-1", file: ".taskless/rules/runtime/a/check.ts" }],
    });
  });

  it("defaults withheld to empty, as restore and retrieval send it", () => {
    expect(parseEntitlement({ runtimeSignatures: false })).toEqual({
      runtimeSignatures: false,
      withheld: [],
    });
  });

  it("drops a withheld entry without a string file, and keeps one without a ruleId", () => {
    const parsed = parseEntitlement({
      runtimeSignatures: false,
      withheld: [
        { ruleId: "r-1" },
        "a/check.ts",
        null,
        { file: 42 },
        { file: "b/check.ts" },
      ],
    });
    expect(parsed?.withheld).toEqual([{ file: "b/check.ts" }]);
  });

  it("omits an upgradeUrl that is not an absolute https URL", () => {
    for (const upgradeUrl of [
      "/o/acme/upgrade",
      "http://app.taskless.io/upgrade",
      "javascript:alert(1)",
      "not a url",
      42,
    ]) {
      const parsed = parseEntitlement({ runtimeSignatures: false, upgradeUrl });
      expect(parsed).toBeDefined();
      expect(parsed).not.toHaveProperty("upgradeUrl");
    }
  });
});
