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

/**
 * A runtime rule written under a plan without runtime signatures is still
 * written, and says it will not run. Driven through the real command, as
 * `rule-guard-json-envelope.test.ts` is, because the warning's whole job is to
 * reach the `--json` envelope an unattended author reads.
 */

const UPGRADE = "https://app.taskless.io/o/acme/upgrade?from=delivery";

const CAPTURE = [
  "id: logs-abc12345",
  "language: typescript",
  "rule:",
  "  pattern: console.log($A)",
  "metadata:",
  "  taskless:",
  "    version: 1",
  "    kind: runtime",
  "    name: logs",
  "    check: check.ts",
  "    match: anchor",
  "",
].join("\n");

const runtimeRule = {
  id: "plan-runtime-rule",
  engine: "runtime",
  files: [
    { path: "check.ts", content: "export default async () => [];\n" },
    { path: "captures/logs.yml", content: CAPTURE },
  ],
};

const staticRule = {
  id: "plan-static-rule",
  engine: "sg",
  files: [
    {
      path: "plan-static-rule.yml",
      content:
        "id: plan-static-rule\nlanguage: TypeScript\nrule:\n  pattern: foo\n",
    },
  ],
};

describe("rule create/improve: a runtime rule the plan will not run", () => {
  let cwd: string;
  let logSpy: MockInstance<(...data: unknown[]) => void>;

  const requestId = "33333333-3333-3333-3333-333333333333";
  const iterateRequestId = "44444444-4444-4444-4444-444444444444";

  function stubFetch(status: Record<string, unknown>): void {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
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
          return Response.json({}, { status: 500 });
        }
        if (method === "POST" && pathname === "/cli/api/request") {
          return Response.json({ requestId }, { status: 200 });
        }
        if (method === "POST" && pathname.endsWith("/iterate")) {
          return Response.json({ requestId: iterateRequestId });
        }
        if (method === "GET" && pathname.startsWith("/cli/api/request/")) {
          return Response.json({ status: "generated", ...status });
        }
        throw new Error(`unexpected ${method} ${pathname}`);
      })
    );
  }

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-rule-plan-"));
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
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
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

  /** The plan warnings in the last `--json` envelope. */
  function planWarnings(): string[] {
    const last = logSpy.mock.calls.at(-1);
    if (!last) throw new Error("console.log was never called");
    const envelope = JSON.parse(String(last[0])) as { notices?: string[] };
    return (envelope.notices ?? []).filter((n) => n.includes("will not run"));
  }

  async function create(): Promise<void> {
    const requestFile = join(cwd, "request.json");
    await writeFile(requestFile, JSON.stringify({ prompt: "add a rule" }));
    await runCommand(ruleCommand, {
      rawArgs: ["create", "--from", requestFile, "--json", "-d", cwd],
    });
  }

  it("rule create writes the rule and warns under --json", async () => {
    stubFetch({
      rules: [runtimeRule],
      entitlement: { runtimeSignatures: false, upgradeUrl: UPGRADE },
    });
    await create();

    const warnings = planWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("plan-runtime-rule");
    expect(warnings[0]).toContain(UPGRADE);
    expect(
      existsSync(
        join(cwd, ".taskless", "rules", "runtime", "plan-runtime-rule")
      )
    ).toBe(true);
  });

  it("rule improve warns the same way", async () => {
    stubFetch({
      rules: [runtimeRule],
      entitlement: { runtimeSignatures: false },
    });
    const requestFile = join(cwd, "improve.json");
    await writeFile(
      requestFile,
      JSON.stringify({ ruleId: "plan-runtime-rule", guidance: "tighten" })
    );
    await runCommand(ruleCommand, {
      rawArgs: ["improve", "--from", requestFile, "--json", "-d", cwd],
    });
    expect(planWarnings()).toHaveLength(1);
  });

  it("an entitled or legacy response does not warn", async () => {
    for (const entitlement of [undefined, { runtimeSignatures: true }]) {
      stubFetch({ rules: [runtimeRule], entitlement });
      await create();
      expect(planWarnings()).toEqual([]);
    }
  });

  it("a static rule never warns, whatever the plan", async () => {
    stubFetch({
      rules: [staticRule],
      entitlement: { runtimeSignatures: false, upgradeUrl: UPGRADE },
    });
    await create();
    expect(planWarnings()).toEqual([]);
  });
});
