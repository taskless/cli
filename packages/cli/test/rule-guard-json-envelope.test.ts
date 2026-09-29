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
  servedBody,
  stubV2Server,
  type StubFile,
  type StubRule,
} from "./support/v2-server";

/**
 * #280: a guard refusing a delivered rule from inside the command's own `try`
 * threw a bare `CLIError` that never touched `fail()`. Under `--json` that
 * skipped the envelope entirely — stdout empty, prose on stderr, exit 1,
 * indistinguishable from a crash.
 *
 * The guard is now signature verification: a served rule whose bytes do not
 * match its signatures is refused before anything is written. These tests
 * drive the ACTUAL command (via citty's own `runCommand`, which parses argv
 * exactly like the built CLI does), because a unit test proving the verifier
 * refuses says nothing about whether the command reports it — that is exactly
 * the seam #280 slipped through.
 */
describe("rule create/improve --json: a served rule that fails verification", () => {
  let cwd: string;
  let logSpy: MockInstance<(...data: unknown[]) => void>;

  const rule: StubRule = {
    id: "guard-test-rule-3fa9c21b",
    engine: "sg",
    files: [
      {
        path: "guard-test-rule-3fa9c21b.yml",
        content:
          "id: guard-test-rule-3fa9c21b\nlanguage: TypeScript\nrule:\n  pattern: foo\n",
      },
      { path: ".tests/fail/case.ts", content: "foo();\n" },
    ],
  };

  /** Serve the rule with its file edited AFTER signing. */
  async function stubTampered(): Promise<void> {
    const body = await servedBody(rule, "rev-1");
    const [fileSet] = body.rules as Array<{ files: StubFile[] }>;
    fileSet!.files[0] = {
      path: "guard-test-rule-3fa9c21b.yml",
      content:
        "id: guard-test-rule-3fa9c21b\nlanguage: TypeScript\nrule:\n  pattern: bar\n",
    };
    stubV2Server({ produced: [{ rule, body }] });
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
    await stubTampered();
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
    expect(envelope.message).toContain(rule.id);
    expect(envelope.message).toContain("signature");
    // Refused before anything was written.
    expect(existsSync(join(cwd, ".taskless", "rules", "sg", rule.id))).toBe(
      false
    );
  });

  it("rule improve --json: reports RULE_GENERATION_FAILED as an envelope on stdout, not a bare throw", async () => {
    await stubTampered();
    const requestFile = join(cwd, "improve-request.json");
    await writeFile(
      requestFile,
      JSON.stringify({ ruleId: rule.id, guidance: "tighten it" })
    );

    const runPromise = runCommand(ruleCommand, {
      rawArgs: ["improve", "--from", requestFile, "--json", "-d", cwd],
    });

    await expect(runPromise).rejects.toThrow();
    expect(process.exitCode).toBe(1);

    const envelope = lastEnvelope();
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("RULE_GENERATION_FAILED");
    expect(envelope.message).toContain(rule.id);
    expect(envelope.message).toContain("signature");
    // Refused before anything was written.
    expect(existsSync(join(cwd, ".taskless", "rules", "sg", rule.id))).toBe(
      false
    );
  });
});
