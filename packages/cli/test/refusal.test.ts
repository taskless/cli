import { describe, expect, it } from "vitest";

import { parseRefusal, stripControlCharacters } from "../src/api/refusal";

const UPGRADE = "https://app.taskless.io/org/1/upgrade?from=restore";

describe("parseRefusal", () => {
  it("is undefined unless restoreRules is exactly false", () => {
    for (const value of [
      undefined,
      null,
      {},
      { restoreRules: true },
      { restoreRules: "false" },
      [],
    ]) {
      expect(parseRefusal(value)).toBeUndefined();
    }
  });

  it("reads the documented refusal", () => {
    expect(
      parseRefusal({
        restoreRules: false,
        reason: "RESTORE_RULES_NOT_IN_PLAN",
        message: "Recover it with git.\nSee the delivering PR.",
        upgradeUrl: UPGRADE,
      })
    ).toEqual({
      reason: "RESTORE_RULES_NOT_IN_PLAN",
      message: "Recover it with git.\nSee the delivering PR.",
      upgradeUrl: UPGRADE,
    });
  });

  it("keeps a refusal whose reason it does not recognize", () => {
    expect(
      parseRefusal({
        restoreRules: false,
        reason: "SOMETHING_NEW",
        message: "No.",
      })
    ).toEqual({ reason: "SOMETHING_NEW", message: "No." });
  });

  it("gives a refusal with no message a generic one rather than dropping it", () => {
    const refusal = parseRefusal({ restoreRules: false, reason: "X" });
    expect(refusal?.message).toContain("(X)");
  });

  it("drops an upgrade URL that is not absolute https", () => {
    for (const upgradeUrl of [
      "/org/1/upgrade",
      "http://app.taskless.io/x",
      "not a url",
    ]) {
      expect(
        parseRefusal({
          restoreRules: false,
          reason: "X",
          message: "m",
          upgradeUrl,
        })?.upgradeUrl
      ).toBeUndefined();
    }
  });

  it("strips an ANSI escape from the message", () => {
    const refusal = parseRefusal({
      restoreRules: false,
      reason: "X",
      message: "\u001B[2J\u001B[31mcleared\u001B[0m",
    });
    expect(refusal?.message).not.toContain("\u001B");
    expect(refusal?.message).toBe("[2J[31mcleared[0m");
  });
});

describe("stripControlCharacters", () => {
  it("keeps newlines and removes every other C0, DEL, and C1 character", () => {
    expect(stripControlCharacters("a\nb\tc\rd\u0007e\u007Ff\u009Bg")).toBe(
      "a\nbcdefg"
    );
  });

  it("leaves ordinary Unicode alone", () => {
    expect(stripControlCharacters("restaurée — ✓")).toBe("restaurée — ✓");
  });
});
