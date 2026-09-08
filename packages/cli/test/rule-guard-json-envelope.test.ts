import { execFileSync } from "node:child_process";
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

/**
 * #280: the guard refusing a file-set rule that also carries a stray `tests`
 * field threw a bare `CLIError` from inside the command's own `try`, never
 * touching `fail()`. Under `--json` that skipped the envelope entirely —
 * stdout empty, prose on stderr, exit 1, indistinguishable from a crash.
 *
 * These tests drive the ACTUAL command (via citty's own `runCommand`, which
 * parses argv exactly like the built CLI does) rather than the guard function
 * in isolation, because a unit test proving the function throws correctly
 * says nothing about whether the command reports it correctly — that is
 * exactly the seam #280 slipped through.
 */
describe("rule create/improve --json: file-set rule with a stray `tests` field", () => {
  let cwd: string;
  let logSpy: MockInstance<(...data: unknown[]) => void>;

  const requestId = "11111111-1111-1111-1111-111111111111";
  const iterateRequestId = "22222222-2222-2222-2222-222222222222";

  // A minimal ast-grep file-set delivery for engine "sg": one file at
  // `<id>.yml` (the only file `ENGINE_LAYOUTS.sg` requires), plus the stray
  // `tests` field the schema says a file set must never carry.
  const badRule = {
    id: "guard-test-rule",
    engine: "sg",
    files: [
      {
        path: "guard-test-rule.yml",
        content:
          "id: guard-test-rule\nlanguage: TypeScript\nrule:\n  pattern: foo\n",
      },
    ],
    tests: { valid: ["const x = 1;"], invalid: ["foo();"] },
  };

  function stubFetch(pollRequestId: string): void {
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        );
        const method = (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        const { pathname } = url;

        if (pathname === "/cli/api/whoami") {
          // Swallowed by fetchWhoami; resolveOrgSubject falls back to the
          // token-claim path. Not what this test is about.
          return Response.json({}, { status: 500 });
        }
        if (method === "POST" && pathname === "/cli/api/request") {
          return Response.json({ requestId }, { status: 200 });
        }
        if (
          method === "GET" &&
          pathname === `/cli/api/request/${pollRequestId}`
        ) {
          return Response.json(
            { status: "generated", rules: [badRule] },
            { status: 200 }
          );
        }
        if (
          method === "POST" &&
          pathname === "/cli/api/request/guard-test-rule/iterate"
        ) {
          return Response.json(
            { requestId: iterateRequestId },
            { status: 200 }
          );
        }
        throw new Error(`unexpected ${method} ${pathname}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);
  }

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-rule-guard-"));
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({
        version: "2026-03-03",
        orgId: 123,
        repositoryUrl: "https://github.com/test/test",
      })
    );
    // resolveRepositoryUrl shells out to `git`; give it a real repo to read
    // rather than mocking the module, so the test exercises the same path
    // the built CLI does.
    execFileSync("git", ["init"], { cwd });
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/test/test.git"],
      { cwd }
    );

    process.env.TASKLESS_TOKEN = "test-token";
    process.env.TASKLESS_API_URL = "https://example.invalid/cli";

    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The command's poll loop always waits `POLL_INTERVAL_MS` (15s) before
    // its first status check, real or mocked. Stubbing `setTimeout` to fire
    // immediately collapses that wait to nothing without needing to reach
    // into (or export) the command's private constant.
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
    await rm(cwd, { recursive: true, force: true });
  });

  /** Envelope is the JSON blob most recently written to stdout via console.log. */
  function lastEnvelope(): { ok: boolean; code?: string; message?: string } {
    const calls = logSpy.mock.calls;
    const lastCall = calls.at(-1);
    if (!lastCall) throw new Error("console.log was never called");
    return JSON.parse(String(lastCall[0])) as {
      ok: boolean;
      code?: string;
      message?: string;
    };
  }

  it("rule create --json: reports RULE_GENERATION_FAILED as an envelope on stdout, not a bare throw", async () => {
    stubFetch(requestId);
    const requestFile = join(cwd, "request.json");
    await writeFile(requestFile, JSON.stringify({ prompt: "add a rule" }));

    const runPromise = runCommand(ruleCommand, {
      rawArgs: ["create", "--from", requestFile, "--json", "-d", cwd],
    });

    await expect(runPromise).rejects.toThrow();
    expect(process.exitCode).toBe(1);

    const envelope = lastEnvelope();
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("RULE_GENERATION_FAILED");
    expect(envelope.message).toContain("guard-test-rule");
    expect(envelope.message).toContain("tests");
  });

  it("rule improve --json: reports RULE_GENERATION_FAILED as an envelope on stdout, not a bare throw", async () => {
    stubFetch(iterateRequestId);
    const requestFile = join(cwd, "improve-request.json");
    await writeFile(
      requestFile,
      JSON.stringify({ ruleId: "guard-test-rule", guidance: "tighten it" })
    );

    const runPromise = runCommand(ruleCommand, {
      rawArgs: ["improve", "--from", requestFile, "--json", "-d", cwd],
    });

    await expect(runPromise).rejects.toThrow();
    expect(process.exitCode).toBe(1);

    const envelope = lastEnvelope();
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("RULE_GENERATION_FAILED");
    expect(envelope.message).toContain("guard-test-rule");
    expect(envelope.message).toContain("tests");
  });
});
