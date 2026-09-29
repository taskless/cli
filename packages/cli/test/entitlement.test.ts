import { describe, expect, it } from "vitest";

import { parseEntitlementV2 } from "../src/api/entitlement";

const UPGRADE = "https://app.taskless.io/o/acme/upgrade?from=reconcile";

describe("parseEntitlementV2", () => {
  it("keeps every withheld rule, which the v1 parser dropped (#403)", () => {
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

    // The hazard (#403): the v1 parser keyed on `file`, which v2 entries do
    // not carry, and read this body as withholding nothing. Every entry has to
    // come through.
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

  it("keeps an upgrade URL only when it is absolute https", () => {
    for (const upgradeUrl of [
      "/o/acme/upgrade",
      "http://app.taskless.io/x",
      "nope",
    ]) {
      expect(
        parseEntitlementV2({ runtimeSignatures: false, upgradeUrl })
      ).not.toHaveProperty("upgradeUrl");
    }
    expect(
      parseEntitlementV2({ runtimeSignatures: false, upgradeUrl: UPGRADE })
        ?.upgradeUrl
    ).toBe(UPGRADE);
  });
});
