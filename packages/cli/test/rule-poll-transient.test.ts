import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { runCommand } from "citty";

import { ruleCommand } from "../src/commands/rules";
import {
  ITERATE_REQUEST_ID,
  REQUEST_ID,
  servedBody,
  stubV2Server,
  type StubFailure,
  type StubRule,
} from "./support/v2-server";

/** How many calls the stub received for `method` on a path under `prefix`. */
function calls(
  fetchMock: ReturnType<typeof vi.fn>,
  method: string,
  prefix: string
): number {
  return fetchMock.mock.calls.filter((call) => {
    const input = call[0] as string | URL | Request;
    const request = input instanceof Request ? input : new Request(input);
    return (
      request.method === method &&
      new URL(request.url).pathname.startsWith(prefix)
    );
  }).length;
}

/** `count` copies of one failure. */
function repeat(count: number, failure: StubFailure): StubFailure[] {
  return Array.from({ length: count }, () => failure);
}

/**
 * #466: polling a request, and fetching the rules it produced, gave up on the
 * first transient failure. Retrying meant running the command again, which
 * submitted a SECOND generation request while the first was still running.
 *
 * A retryable `unavailable` (a network failure, `408`, `429`, `5xx`) is now
 * absorbed up to a consecutive-failure budget; anything that is an answer
 * still fails at once. These drive the real command, because the budget and
 * the give-up message only mean something end to end.
 */
describe("rule create: transient failures while polling and fetching", () => {
  let cwd: string;
  let logSpy: MockInstance<(...data: unknown[]) => void>;
  let errorSpy: MockInstance<(...data: unknown[]) => void>;

  const rule: StubRule = {
    id: "poll-test-rule-3fa9c21b",
    engine: "sg",
    files: [
      {
        path: "poll-test-rule-3fa9c21b.yml",
        content:
          "id: poll-test-rule-3fa9c21b\nlanguage: TypeScript\nrule:\n  pattern: foo\n",
      },
      { path: ".tests/fail/case.ts", content: "foo();\n" },
    ],
  };

  async function stub(failures: {
    poll?: Array<StubFailure | "building">;
    fetch?: StubFailure[];
  }): Promise<ReturnType<typeof vi.fn>> {
    return stubV2Server({
      produced: [{ rule, body: await servedBody(rule, "rev-1") }],
      failures,
    });
  }

  async function create(): Promise<void> {
    const requestFile = join(cwd, "request.json");
    await writeFile(requestFile, JSON.stringify({ prompt: "add a rule" }));
    await runCommand(ruleCommand, {
      rawArgs: ["create", "--from", requestFile, "--json", "-d", cwd],
    });
  }

  async function resume(
    subcommand: "create" | "improve",
    requestId: string,
    ...extra: string[]
  ): Promise<void> {
    await runCommand(ruleCommand, {
      rawArgs: [
        subcommand,
        "--resume",
        requestId,
        ...extra,
        "--json",
        "-d",
        cwd,
      ],
    });
  }

  function lastEnvelope(): Record<string, unknown> {
    const lastCall = logSpy.mock.calls.at(-1);
    if (!lastCall) throw new Error("console.log was never called");
    return JSON.parse(String(lastCall[0])) as Record<string, unknown>;
  }

  const ruleFile = (): string =>
    join(cwd, ".taskless", "rules", "sg", rule.id, `${rule.id}.yml`);

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-rule-poll-"));
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({
        version: "2026-03-03",
        orgId: 123,
        repositoryUrl: "https://github.com/test/test",
      })
    );
    execFileSync("git", ["init"], { cwd });
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/test/test.git"],
      { cwd }
    );

    process.env.TASKLESS_TOKEN = "test-token";
    process.env.TASKLESS_API_URL = "https://example.invalid/cli";
    process.exitCode = undefined;

    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Collapse every wait between attempts to nothing.
    vi.stubGlobal(
      "setTimeout",
      (function_: (...arguments_: unknown[]) => void) => {
        function_();
        return 0 as unknown as NodeJS.Timeout;
      }
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.TASKLESS_TOKEN;
    delete process.env.TASKLESS_API_URL;
    process.exitCode = undefined;
    await rm(cwd, { recursive: true, force: true });
  });

  it("keeps polling through a run of retryable failures and delivers the rule", async () => {
    const fetchMock = await stub({
      poll: ["network", 503, 429, 408, 502, "network", 500],
    });

    await create();

    expect(process.exitCode).toBeUndefined();
    expect(lastEnvelope()).toMatchObject({
      success: true,
      requestId: REQUEST_ID,
      rules: [rule.id],
    });
    expect(existsSync(ruleFile())).toBe(true);
    // One request was submitted, however many polls it took.
    expect(calls(fetchMock, "GET", "/cli/api/v2/request/")).toBe(8);
    expect(calls(fetchMock, "POST", "/cli/api/v2/request")).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Status check failed (HTTP 503); retrying")
    );
  });

  it("gives up after the budget, naming the request and saying it may still complete", async () => {
    const fetchMock = await stub({ poll: repeat(8, 503) });

    await expect(create()).rejects.toThrow();

    expect(process.exitCode).toBe(1);
    const envelope = lastEnvelope();
    expect(envelope.code).toBe("NETWORK_ERROR");
    expect(envelope.message).toContain("8 times in a row");
    expect(envelope.message).toContain(REQUEST_ID);
    expect(envelope.message).toContain("may still complete");
    expect(envelope.message).toContain(`rule create --resume ${REQUEST_ID}`);
    expect(calls(fetchMock, "GET", "/cli/api/v2/request/")).toBe(8);
  });

  it("counts consecutive failures only: an answer in between resets the budget", async () => {
    // 14 failures in all, but never 8 in a row.
    const run = repeat(7, 429);
    const fetchMock = await stub({ poll: [...run, "building", ...run] });

    await create();

    expect(process.exitCode).toBeUndefined();
    expect(existsSync(ruleFile())).toBe(true);
    expect(calls(fetchMock, "GET", "/cli/api/v2/request/")).toBe(16);
  });

  it("fails at once on a non-retryable unavailable, without spending the budget", async () => {
    const fetchMock = await stub({ poll: [418] });

    await expect(create()).rejects.toThrow();

    const envelope = lastEnvelope();
    expect(envelope.code).toBe("NETWORK_ERROR");
    expect(envelope.message).toContain("HTTP 418");
    expect(envelope.message).not.toContain("times in a row");
    expect(envelope.message).toContain(REQUEST_ID);
    expect(calls(fetchMock, "GET", "/cli/api/v2/request/")).toBe(1);
  });

  it("fails at once on a rejected token", async () => {
    const fetchMock = await stub({ poll: [401] });

    await expect(create()).rejects.toThrow();

    expect(lastEnvelope().code).toBe("AUTH_REQUIRED");
    expect(calls(fetchMock, "GET", "/cli/api/v2/request/")).toBe(1);
  });

  it("retries fetching a generated rule through transient failures", async () => {
    const fetchMock = await stub({ fetch: [503, "network", 429] });

    await create();

    expect(process.exitCode).toBeUndefined();
    expect(existsSync(ruleFile())).toBe(true);
    expect(calls(fetchMock, "GET", "/cli/api/v2/rule/")).toBe(4);
  });

  it("gives up fetching after the budget, naming the rule and the request, and writes nothing", async () => {
    const fetchMock = await stub({ fetch: repeat(8, 500) });

    await expect(create()).rejects.toThrow();

    const envelope = lastEnvelope();
    expect(envelope.code).toBe("NETWORK_ERROR");
    expect(envelope.message).toContain(rule.id);
    expect(envelope.message).toContain(REQUEST_ID);
    expect(envelope.message).toContain("8 times in a row");
    expect(envelope.message).toContain("No rules were written");
    expect(envelope.message).toContain(`rule create --resume ${REQUEST_ID}`);
    expect(calls(fetchMock, "GET", "/cli/api/v2/rule/")).toBe(8);
    expect(existsSync(ruleFile())).toBe(false);
  });

  describe("--resume", () => {
    it("picks up a request a give-up abandoned, without submitting another", async () => {
      // One stub across both runs: the first spends all 8 failures and gives
      // up, the resumed run finds the service answering again.
      const fetchMock = await stub({ poll: repeat(8, 503) });
      await expect(create()).rejects.toThrow();
      expect(existsSync(ruleFile())).toBe(false);
      process.exitCode = undefined;

      await resume("create", REQUEST_ID);

      expect(process.exitCode).toBeUndefined();
      expect(lastEnvelope()).toMatchObject({
        success: true,
        requestId: REQUEST_ID,
        rules: [rule.id],
      });
      expect(existsSync(ruleFile())).toBe(true);
      expect(calls(fetchMock, "POST", "/cli/api/v2/request")).toBe(1);
    });

    it("fetches a generated rule a give-up left unwritten, without generating it again", async () => {
      const fetchMock = await stub({ fetch: repeat(8, 500) });
      await expect(create()).rejects.toThrow();
      process.exitCode = undefined;

      await resume("create", REQUEST_ID);

      expect(existsSync(ruleFile())).toBe(true);
      expect(calls(fetchMock, "POST", "/cli/api/v2/request")).toBe(1);
    });

    it("rule improve --resume polls the iterate request and submits no iteration", async () => {
      const fetchMock = await stub({});

      await resume("improve", ITERATE_REQUEST_ID);

      expect(process.exitCode).toBeUndefined();
      expect(lastEnvelope()).toMatchObject({
        success: true,
        requestId: ITERATE_REQUEST_ID,
        rules: [rule.id],
      });
      expect(existsSync(ruleFile())).toBe(true);
      expect(calls(fetchMock, "POST", "/cli/api/v2/rule/")).toBe(0);
      expect(
        calls(fetchMock, "GET", `/cli/api/v2/request/${ITERATE_REQUEST_ID}`)
      ).toBe(1);
    });

    it("refuses --resume with --from: a resumed request has nothing to submit", async () => {
      const fetchMock = await stub({});

      await expect(
        resume("create", REQUEST_ID, "--from", "request.json")
      ).rejects.toThrow();

      expect(lastEnvelope().code).toBe("INVALID_INPUT");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses a request id that is not a UUID before calling the service", async () => {
      const fetchMock = await stub({});

      await expect(resume("improve", "no-eval-3fa9c21b")).rejects.toThrow();

      const envelope = lastEnvelope();
      expect(envelope.code).toBe("INVALID_INPUT");
      expect(envelope.message).toContain("no-eval-3fa9c21b");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
