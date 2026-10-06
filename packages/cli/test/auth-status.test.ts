import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WhoamiResult } from "../src/api/v2";
import { describeAuthStatus } from "../src/auth/status";

const identity: WhoamiResult = {
  user: "someone",
  orgs: [
    {
      orgId: 1,
      id: "00000000-0000-0000-0000-000000000001",
      name: "acme",
      source: "github",
      url: "https://github.com/acme",
    },
  ],
};

let previousToken: string | undefined;

beforeEach(() => {
  previousToken = process.env.TASKLESS_TOKEN;
  delete process.env.TASKLESS_TOKEN;
});

afterEach(() => {
  if (previousToken === undefined) {
    delete process.env.TASKLESS_TOKEN;
  } else {
    process.env.TASKLESS_TOKEN = previousToken;
  }
});

describe("describeAuthStatus", () => {
  it("names the user and orgs for an accepted saved token", () => {
    expect(describeAuthStatus({ status: "ok", data: identity })).toEqual([
      "Logged in as someone (acme).",
    ]);
  });

  it("says when the token comes from TASKLESS_TOKEN", () => {
    process.env.TASKLESS_TOKEN = "env-token";

    expect(describeAuthStatus({ status: "ok", data: identity })).toEqual([
      "Logged in as someone (acme) via TASKLESS_TOKEN.",
    ]);
  });

  it("reports a rejected saved token with auth login as the fix", () => {
    const lines = describeAuthStatus({ status: "unauthorized" });

    expect(lines[0]).toBe("Logged in, but the token was rejected.");
    expect(lines[1]).toMatch(/auth login` to replace the saved token\.$/);
  });

  it("reports a rejected TASKLESS_TOKEN with the variable as the fix", () => {
    process.env.TASKLESS_TOKEN = "env-token";

    const lines = describeAuthStatus({ status: "unauthorized" });

    expect(lines[0]).toBe(
      "Logged in via TASKLESS_TOKEN, but the token was rejected."
    );
    expect(lines[1]).toMatch(/replace or unset it/);
  });

  it("does not call a token invalid when the service is unreachable", () => {
    const lines = describeAuthStatus({
      status: "unavailable",
      reason: "network error: offline",
      retryable: true,
    });

    expect(lines).toEqual([
      "Logged in, but unable to verify identity.",
      "The Taskless service was unreachable (network error: offline).",
    ]);
    expect(lines.join("\n")).not.toMatch(/rejected|invalid|expired/);
  });
});
