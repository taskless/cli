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
  REQUEST_ID,
  servedBody,
  stubV2Server,
  type StubRule,
} from "./support/v2-server";

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

const runtimeRule: StubRule = {
  id: "plan-runtime-rule",
  engine: "runtime",
  files: [
    { path: ".tests/fail/case.ts", content: "console.log(1);\n" },
    { path: "check.ts", content: "export default async () => [];\n" },
    { path: "captures/logs.yml", content: CAPTURE },
  ],
};

const staticRule: StubRule = {
  id: "plan-static-rule",
  engine: "sg",
  files: [
    { path: ".tests/fail/case.ts", content: "foo();\n" },
    {
      path: "plan-static-rule.yml",
      content:
        "id: plan-static-rule\nlanguage: TypeScript\nrule:\n  pattern: foo\n",
    },
  ],
};

/** Serve `rule` from a request, with `extra` on its served body. */
async function stubFetch(
  rule: StubRule,
  extra: Record<string, unknown> = {}
): Promise<void> {
  stubV2Server({
    produced: [{ rule, body: await servedBody(rule, "rev-1", extra) }],
  });
}

describe("rule create/improve: a runtime rule the plan will not run", () => {
  let cwd: string;
  let logSpy: MockInstance<(...data: unknown[]) => void>;

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
    await stubFetch(runtimeRule, {
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
    await stubFetch(runtimeRule, {
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
      await stubFetch(
        runtimeRule,
        entitlement === undefined ? {} : { entitlement }
      );
      await create();
      expect(planWarnings()).toEqual([]);
    }
  });

  it("a static rule never warns, whatever the plan", async () => {
    await stubFetch(staticRule, {
      entitlement: { runtimeSignatures: false, upgradeUrl: UPGRADE },
    });
    await create();
    expect(planWarnings()).toEqual([]);
  });

  it("rule create --json names the request and the written rules, and no ruleId", async () => {
    await stubFetch(staticRule);
    await create();
    const envelope = JSON.parse(
      String(logSpy.mock.calls.at(-1)?.[0])
    ) as Record<string, unknown>;
    expect(envelope.requestId).toBe(REQUEST_ID);
    expect(envelope.rules).toEqual(["plan-static-rule"]);
    expect(envelope).not.toHaveProperty("ruleId");
  });

  it("replaces the rule directory, fixtures included, and creates nested paths", async () => {
    const directory = join(cwd, ".taskless", "rules", "sg", "plan-static-rule");
    await mkdir(join(directory, ".tests", "stale"), { recursive: true });
    await writeFile(join(directory, ".tests", "stale", "old.ts"), "old\n");
    await writeFile(join(directory, "stray.yml"), "id: stray\n");

    await stubFetch(staticRule);
    await create();

    expect(existsSync(join(directory, ".tests", "fail", "case.ts"))).toBe(true);
    expect(existsSync(join(directory, ".tests", "stale", "old.ts"))).toBe(
      false
    );
    expect(existsSync(join(directory, "stray.yml"))).toBe(false);
  });

  it("refuses a served head whose revision is not the one the request produced", async () => {
    stubV2Server({
      produced: [
        {
          rule: staticRule,
          body: {
            ...(await servedBody(staticRule, "rev-2")),
            // Polling reports the revision the stub's body names, so pin the
            // poll to rev-1 by serving a mismatched body under a rev-1 claim.
            revisionId: "rev-2",
          },
        },
      ],
    });
    // Polling reads `body.revisionId`; make it disagree with what is served.
    const fetchMock = globalThis.fetch as unknown as {
      getMockImplementation: () => (input: Request) => Promise<Response>;
      mockImplementation: (f: (input: Request) => Promise<Response>) => void;
    };
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input: Request) => {
      const url = new URL(input.url);
      if (url.pathname.startsWith("/cli/api/v2/request/")) {
        return Response.json({
          requestId: REQUEST_ID,
          status: "generated",
          revisions: [{ ruleId: "plan-static-rule", revisionId: "rev-1" }],
        });
      }
      return original(input);
    });

    await expect(create()).rejects.toThrow();
    const envelope = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as {
      code?: string;
      message?: string;
    };
    expect(envelope.code).toBe("RULE_GENERATION_FAILED");
    expect(envelope.message).toContain("rev-2");
    expect(
      existsSync(join(cwd, ".taskless", "rules", "sg", "plan-static-rule"))
    ).toBe(false);
  });

  it("prints a failed request's error as given", async () => {
    stubV2Server({
      produced: [],
      status: "failed",
      error: "REMOTE_GENERATION_NOT_IN_PLAN: \u001B[31mupgrade\u001B[0m",
    });
    await expect(create()).rejects.toThrow();
    const envelope = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as {
      code?: string;
      message?: string;
    };
    expect(envelope.code).toBe("RULE_GENERATION_FAILED");
    expect(envelope.message).toContain("REMOTE_GENERATION_NOT_IN_PLAN");
    expect(envelope.message).not.toContain("\u001B");
  });

  it("rule improve reports an unknown rule id as RULE_NOT_FOUND", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: Request) => {
        const { pathname } = new URL(input.url);
        if (pathname === "/cli/api/whoami") {
          return Response.json({}, { status: 500 });
        }
        return Response.json({ error: "rule_not_found" }, { status: 404 });
      })
    );
    const requestFile = join(cwd, "improve.json");
    await writeFile(
      requestFile,
      JSON.stringify({ ruleId: "gone-00000000", guidance: "tighten" })
    );
    await expect(
      runCommand(ruleCommand, {
        rawArgs: ["improve", "--from", requestFile, "--json", "-d", cwd],
      })
    ).rejects.toThrow();
    const envelope = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as {
      code?: string;
    };
    expect(envelope.code).toBe("RULE_NOT_FOUND");
  });
});
