import { describe, expect, it } from "vitest";

import { unsupportedMessage } from "../src/rules/unsupported";

/**
 * A terminal `unsupported` is the service saying "understood, and no". What it
 * cannot say for us is WHY, so the reason it sends has to reach the reader.
 *
 * This used to be one hardcoded sentence about plans and entitlements, written
 * when the only way to reach `unsupported` was an account that lacked a
 * capability. The service now also terminates a request as unsupported when
 * the CLI is below the floor a runtime rule needs — the same status, an
 * entirely different fix.
 */

const CLI_FLOOR =
  "This request needs a runtime rule, which requires Taskless CLI 0.11.1 or newer.";

describe("explaining a terminal unsupported", () => {
  it("uses the reason the service sent", () => {
    const message = unsupportedMessage(CLI_FLOOR);
    expect(message).toContain(CLI_FLOOR);
  });

  it("does not tell a reader to upgrade their plan when the CLI is the problem", () => {
    // The specific regression. A user on 0.10.x was told to ask an
    // administrator for a capability they already had, while the one command
    // that would have fixed it went unmentioned.
    const message = unsupportedMessage(CLI_FLOOR);
    expect(message).not.toMatch(/plan/i);
    expect(message).not.toMatch(/administrator/i);
  });

  it("strips padding the service sent with its reason", () => {
    // The gap that let this through: nothing exercised a reason that was
    // non-empty but padded, which is the ordinary shape of a templated server
    // string. The old code tested `reason.trim()` and then interpolated
    // `reason`, so the newline survived into the message and the envelope.
    const message = unsupportedMessage(`\n  ${CLI_FLOOR}\n\n`);
    expect(message).toContain(CLI_FLOOR);
    expect(message.endsWith(CLI_FLOOR)).toBe(true);
    expect(message).not.toMatch(/\n{3}/);
  });

  it.each([
    ["no reason at all", undefined],
    ["an empty reason", ""],
    ["a whitespace-only reason", "   \n  "],
  ])("falls back to the entitlement text given %s", (_label, reason) => {
    // The original meaning, kept for an `unsupported` that arrives bare. A
    // blank string is not a reason, and printing one would leave the reader
    // with a heading and nothing under it.
    const message = unsupportedMessage(reason);
    expect(message).toMatch(/plan/i);
    expect(message).toContain("runtime rules");
  });

  it("never reads as a failure", () => {
    // `unsupported` is deliberately not `failed`: nothing failed, and a reader
    // told otherwise goes looking for a service bug instead of for the thing
    // they have to change.
    for (const message of [
      unsupportedMessage(CLI_FLOOR),
      unsupportedMessage(),
    ]) {
      expect(message).not.toMatch(/\bfailed\b/i);
      expect(message).not.toMatch(/\berror\b/i);
    }
  });
});
