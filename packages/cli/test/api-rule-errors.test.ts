import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { iterateRule } from "../src/api/rules";
import { CLIError } from "../src/util/cli-error";

function stubResponse(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json(body, { status }))
  );
}

/**
 * `rule improve` takes a ticket id from the caller (the `ruleId` field of
 * `rule create --json`, or from the user), so a 404 on that id is a state the
 * caller can act on. The code has to travel on the error, because the command
 * otherwise reports every `iterateRule` failure as NETWORK_ERROR — which tells
 * an agent to retry an id that will never resolve.
 */
describe("iterateRule error codes", () => {
  const originalUrl = process.env.TASKLESS_API_URL;

  beforeEach(() => {
    process.env.TASKLESS_API_URL = "https://example.invalid/cli";
  });

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.TASKLESS_API_URL;
    } else {
      process.env.TASKLESS_API_URL = originalUrl;
    }
    vi.unstubAllGlobals();
  });

  it("carries RULE_NOT_FOUND on a 404 for the supplied ticket id", async () => {
    stubResponse(404, { error: "request_not_found" });

    const error_ = await iterateRule("token", "missing-id", {
      orgId: "org",
      guidance: "tighten it",
    }).catch((error_: unknown) => error_);

    expect(error_).toBeInstanceOf(CLIError);
    expect((error_ as CLIError).code).toBe("RULE_NOT_FOUND");
  });

  it("leaves an unclassified failure without a code, so it reports as NETWORK_ERROR", async () => {
    stubResponse(500, { error: "internal" });

    const error_ = await iterateRule("token", "some-id", {
      orgId: "org",
      guidance: "tighten it",
    }).catch((error_: unknown) => error_);

    expect(error_).toBeInstanceOf(Error);
    expect((error_ as CLIError).code).toBeUndefined();
  });
});
