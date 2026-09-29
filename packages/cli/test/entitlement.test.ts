import { describe, expect, it } from "vitest";

import { parseEntitlement, parseEntitlementV2 } from "../src/api/entitlement";

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

describe("parseEntitlementV2", () => {
  it("keeps every withheld rule, which the v1 parser would have dropped (#403)", () => {
    const withheld = [
      { ruleId: "no-env-leak-3fa9c21b", revisionId: "rev-1" },
      { ruleId: "no-eval-00000000", revisionId: "rev-2" },
    ];
    const body = {
      runtimeSignatures: false,
      reason: "RUNTIME_SIGNATURES_NOT_IN_PLAN",
      upgradeUrl: UPGRADE,
      withheld,
    };

    // The hazard: v1's parser keys on `file`, which v2 entries do not carry.
    expect(parseEntitlement(body)?.withheld).toEqual([]);

    expect(parseEntitlementV2(body)).toEqual({
      runtimeSignatures: false,
      reason: "RUNTIME_SIGNATURES_NOT_IN_PLAN",
      upgradeUrl: UPGRADE,
      withheld,
    });
  });

  it("keeps an entry that lacks a revision id", () => {
    expect(
      parseEntitlementV2({
        runtimeSignatures: false,
        withheld: [{ ruleId: "a" }],
      })?.withheld
    ).toEqual([{ ruleId: "a" }]);
  });

  it("drops only an entry with no rule id, since nothing can be joined to it", () => {
    expect(
      parseEntitlementV2({
        runtimeSignatures: false,
        withheld: [{ revisionId: "r" }, "junk", { ruleId: "a" }],
      })?.withheld
    ).toEqual([{ ruleId: "a" }]);
  });

  it("is undefined for an entitled organization or anything but exactly false", () => {
    for (const value of [
      undefined,
      { runtimeSignatures: true },
      { runtimeSignatures: "false" },
    ]) {
      expect(parseEntitlementV2(value)).toBeUndefined();
    }
  });
});
