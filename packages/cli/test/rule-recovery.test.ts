import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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
import { canonicalHash } from "../src/rules/rule-hash";
import { servedBody, type StubRule } from "./support/v2-server";

/**
 * `rule restore` and `rule rollback`, driven through the real command against
 * a stubbed v2 service. What matters most here is what does NOT happen: a
 * restore that would advance a rule, a revision nobody asked for, or a refusal
 * read as an outage, each of which must leave the tree exactly as it was.
 */

const RULE_ID = "no-eval-3fa9c21b";
const ISSUED = `id: ${RULE_ID}\nlanguage: TypeScript\nrule:\n  pattern: eval($A)\n`;
const NEWER = `id: ${RULE_ID}\nlanguage: TypeScript\nrule:\n  pattern: eval($$$A)\n`;
const EDITED = `id: ${RULE_ID}\nlanguage: TypeScript\nrule:\n  pattern: never_matches_anything\n`;

function sgRule(content: string): StubRule {
  return {
    id: RULE_ID,
    engine: "sg",
    files: [
      { path: `${RULE_ID}.yml`, content },
      { path: ".tests/fail/case.ts", content: "eval(x);\n" },
    ],
  };
}

type Verdict =
  | { kind: "run" | "unknown" | "withheld" }
  | { kind: "unsafe"; expected: string; engine?: string }
  | { kind: "missing"; revisionId: string; engine?: string };

interface Stub {
  verdict: Verdict;
  /** The body restore or rollback answers with. */
  served?: Record<string, unknown>;
  /** A status for restore / rollback other than 200. */
  status?: number;
  /** The body the revisions listing answers with, and its status. */
  revisions?: { body: unknown; status?: number };
  /** The acting org's `entitlements.restoreRules`; unset serves no whoami. */
  restoreRules?: boolean;
}

const REFUSAL = {
  restoreRules: false,
  reason: "RESTORE_RULES_NOT_IN_PLAN",
  message:
    "Restoring rules is not included in your Free plan.\nRecover it with git: git log -- .taskless/rules/sg/no-eval-3fa9c21b\u001B[2J",
  upgradeUrl: "https://app.taskless.io/org/1/upgrade?from=restore",
};

function revision(
  revisionId: string,
  current: boolean,
  extra: Record<string, unknown> = {}
) {
  return {
    revisionId,
    createdAt: "2026-09-29T12:00:00.000Z",
    delivery: "cli",
    requestId: `req-${revisionId}`,
    current,
    ...extra,
  };
}

function listing(revisions: unknown[], truncated = false) {
  return { ruleId: RULE_ID, revisions, truncated };
}

const currentLine = (printed: string) =>
  printed.split("\n").filter((line) => line.includes("(current)"));

describe("rule restore / rule rollback", () => {
  let cwd: string;
  let logSpy: MockInstance<(...data: unknown[]) => void>;
  let errorSpy: MockInstance<(...data: unknown[]) => void>;
  let calls: string[];
  const ruleFile = () =>
    join(cwd, ".taskless", "rules", "sg", RULE_ID, `${RULE_ID}.yml`);

  function stub(options: Stub): void {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request) => {
        const url = new URL(input.url);
        calls.push(`${input.method} ${url.pathname}`);
        if (url.pathname === "/cli/api/whoami") {
          return Response.json({}, { status: 500 });
        }
        if (url.pathname === "/cli/api/v2/whoami") {
          if (options.restoreRules === undefined) {
            return Response.json({}, { status: 500 });
          }
          return Response.json({
            user: "Ada",
            orgs: [
              {
                id: "uuid-test",
                name: "test",
                source: "github",
                url: "https://github.com/test",
                entitlements: {
                  remoteGeneration: true,
                  runtimeSignatures: true,
                  restoreRules: options.restoreRules,
                },
              },
            ],
          });
        }
        if (url.pathname === "/cli/api/v2/reconcile") {
          const body = (await input.json()) as {
            rules: { ruleId: string }[];
          };
          const others = body.rules
            .filter((rule) => rule.ruleId !== RULE_ID)
            .map((rule) => ({ ruleId: rule.ruleId }));
          const v = options.verdict;
          const reported = body.rules.some((rule) => rule.ruleId === RULE_ID);
          return Response.json({
            rules:
              v.kind === "run"
                ? [
                    {
                      ruleId: RULE_ID,
                      engine: "sg",
                      verdict: "run",
                      revisionId: "r1",
                    },
                  ]
                : v.kind === "unsafe"
                  ? [
                      {
                        ruleId: RULE_ID,
                        engine: v.engine ?? "sg",
                        verdict: "unsafe",
                        files: [
                          {
                            path: `${RULE_ID}.yml`,
                            expected: v.expected,
                            got: await canonicalHash(EDITED),
                          },
                        ],
                      },
                    ]
                  : v.kind === "missing"
                    ? [
                        {
                          ruleId: RULE_ID,
                          engine: v.engine ?? "sg",
                          verdict: "missing",
                          revisionId: v.revisionId,
                        },
                      ]
                    : [],
            unknown: [
              ...others,
              ...(v.kind === "unknown" && reported
                ? [{ ruleId: RULE_ID }]
                : []),
            ],
            entitlement:
              v.kind === "withheld"
                ? {
                    runtimeSignatures: false,
                    withheld: [{ ruleId: RULE_ID, revisionId: "r1" }],
                  }
                : { runtimeSignatures: true },
          });
        }
        if (url.pathname.endsWith("/revisions") && options.revisions) {
          return Response.json(options.revisions.body, {
            status: options.revisions.status ?? 200,
          });
        }
        if (
          url.pathname.endsWith("/restore") ||
          url.pathname.endsWith("/rollback")
        ) {
          return Response.json(options.served ?? {}, {
            status: options.status ?? 200,
          });
        }
        throw new Error(`unexpected ${input.method} ${url.pathname}`);
      })
    );
  }

  async function writeLocal(content: string): Promise<void> {
    const directory = join(cwd, ".taskless", "rules", "sg", RULE_ID);
    await mkdir(join(directory, ".tests", "fail"), { recursive: true });
    await writeFile(join(directory, `${RULE_ID}.yml`), content);
    await writeFile(join(directory, ".tests", "fail", "case.ts"), "eval(x);\n");
  }

  async function run(argv: string[]): Promise<Record<string, unknown>> {
    await runCommand(ruleCommand, { rawArgs: [...argv, "--json", "-d", cwd] });
    return JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as Record<
      string,
      unknown
    >;
  }

  /** Run without `--json`, returning what was printed to stdout. */
  async function print(): Promise<string> {
    await runCommand(ruleCommand, {
      rawArgs: ["revisions", RULE_ID, "-d", cwd],
    });
    return logSpy.mock.calls.map((call) => String(call[0])).join("\n");
  }

  const restoreCalled = () => calls.some((call) => call.endsWith("/restore"));

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-recovery-"));
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: "2026-03-03", orgId: 123 })
    );
    execFileSync("git", ["init", "-q"], { cwd });
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
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.TASKLESS_TOKEN;
    delete process.env.TASKLESS_API_URL;
    process.exitCode = undefined;
    await rm(cwd, { recursive: true, force: true });
  });

  it("restores an edited rule to exactly what reconcile expected", async () => {
    await writeLocal(EDITED);
    stub({
      verdict: { kind: "unsafe", expected: await canonicalHash(ISSUED) },
      served: {
        ...(await servedBody(sgRule(ISSUED), "r1")),
        restoreRules: true,
      },
    });
    const output = await run(["restore", RULE_ID]);
    expect(output).toMatchObject({
      success: true,
      ruleId: RULE_ID,
      revisionId: "r1",
    });
    expect(await readFile(ruleFile(), "utf8")).toBe(ISSUED);
    expect(String((output.notices as string[])[0])).toContain(
      "next `check` verifies it"
    );
  });

  it("refuses a restore that would advance the rule, and writes nothing", async () => {
    await writeLocal(EDITED);
    stub({
      verdict: { kind: "unsafe", expected: await canonicalHash(ISSUED) },
      served: {
        ...(await servedBody(sgRule(NEWER), "r2")),
        restoreRules: true,
      },
    });
    const output = await run(["restore", RULE_ID]);
    expect(output).toMatchObject({ ok: false, code: "RULE_RESTORE_MISMATCH" });
    expect(String(output.message)).toContain("does not upgrade");
    expect(await readFile(ruleFile(), "utf8")).toBe(EDITED);
    expect(process.exitCode).toBe(1);
  });

  it("refuses a served set whose bytes do not match its own signatures", async () => {
    await writeLocal(EDITED);
    const body = await servedBody(sgRule(ISSUED), "r1");
    (body.rules as { files: { content: string }[] }[])[0]!.files[0]!.content =
      NEWER;
    stub({
      verdict: { kind: "unsafe", expected: await canonicalHash(ISSUED) },
      served: { ...body, restoreRules: true },
    });
    const output = await run(["restore", RULE_ID]);
    expect(output).toMatchObject({ ok: false, code: "RULE_RESTORE_MISMATCH" });
    expect(await readFile(ruleFile(), "utf8")).toBe(EDITED);
  });

  it("restores a missing rule to the revision reconcile named", async () => {
    stub({
      verdict: { kind: "missing", revisionId: "r1" },
      served: {
        ...(await servedBody(sgRule(ISSUED), "r1")),
        restoreRules: true,
      },
    });
    const output = await run(["restore", RULE_ID]);
    expect(output).toMatchObject({ success: true, revisionId: "r1" });
    expect(await readFile(ruleFile(), "utf8")).toBe(ISSUED);
    expect(
      existsSync(
        join(
          cwd,
          ".taskless",
          "rules",
          "sg",
          RULE_ID,
          ".tests",
          "fail",
          "case.ts"
        )
      )
    ).toBe(true);
  });

  it.skipIf(process.getuid?.() === 0)(
    "still names the rule file when only the stale-entry cleanup failed",
    async () => {
      await writeLocal(NEWER);
      const blocked = join(cwd, ".taskless", "rules", "sg", RULE_ID, "blocked");
      await mkdir(blocked);
      await writeFile(join(blocked, "stale.ts"), "stale\n");
      await chmod(blocked, 0o500);
      try {
        stub({
          verdict: { kind: "run" },
          served: {
            ...(await servedBody(sgRule(ISSUED), "r1")),
            restoreRules: true,
          },
        });
        const output = await run(["rollback", RULE_ID, "r1"]);
        expect(output).toMatchObject({
          success: true,
          files: [ruleFile()],
        });
        expect(await readFile(ruleFile(), "utf8")).toBe(ISSUED);
        expect(String((output.notices as string[]).at(-1))).toContain(
          "could not be removed"
        );
      } finally {
        await chmod(blocked, 0o700);
      }
    }
  );

  it("refuses a missing rule served at a different revision", async () => {
    stub({
      verdict: { kind: "missing", revisionId: "r1" },
      served: {
        ...(await servedBody(sgRule(NEWER), "r2")),
        restoreRules: true,
      },
    });
    const output = await run(["restore", RULE_ID]);
    expect(output).toMatchObject({ ok: false, code: "RULE_RESTORE_MISMATCH" });
    expect(existsSync(ruleFile())).toBe(false);
  });

  it("refuses a missing verdict for a rule that is on disk, and writes nothing", async () => {
    await writeLocal(EDITED);
    stub({
      verdict: { kind: "missing", revisionId: "r2" },
      served: {
        ...(await servedBody(sgRule(NEWER), "r2")),
        restoreRules: true,
      },
    });
    const output = await run(["restore", RULE_ID]);
    expect(output).toMatchObject({ ok: false, code: "NETWORK_ERROR" });
    expect(String(output.message)).toContain("is missing");
    expect(await readFile(ruleFile(), "utf8")).toBe(EDITED);
    expect(restoreCalled()).toBe(false);
  });

  it("refuses a verdict judged under another engine, without calling restore", async () => {
    await writeLocal(EDITED);
    stub({
      verdict: {
        kind: "unsafe",
        expected: await canonicalHash(ISSUED),
        engine: "vale",
      },
      served: {
        ...(await servedBody(sgRule(ISSUED), "r1")),
        restoreRules: true,
      },
    });
    const output = await run(["restore", RULE_ID]);
    expect(output).toMatchObject({ ok: false, code: "NETWORK_ERROR" });
    expect(String(output.message)).toContain("vale rule");
    expect(await readFile(ruleFile(), "utf8")).toBe(EDITED);
    expect(restoreCalled()).toBe(false);
  });

  it("refuses a missing rule served under another engine, and writes nothing", async () => {
    stub({
      verdict: { kind: "missing", revisionId: "r1", engine: "vale" },
      served: {
        ...(await servedBody(sgRule(ISSUED), "r1")),
        restoreRules: true,
      },
    });
    const output = await run(["restore", RULE_ID]);
    expect(output).toMatchObject({ ok: false, code: "RULE_RESTORE_MISMATCH" });
    expect(existsSync(ruleFile())).toBe(false);
  });

  it("leaves an intact rule alone and never calls restore", async () => {
    await writeLocal(ISSUED);
    stub({ verdict: { kind: "run" } });
    const output = await run(["restore", RULE_ID]);
    expect(output).toMatchObject({ success: true, ruleId: RULE_ID, files: [] });
    expect(restoreCalled()).toBe(false);
  });

  it("leaves a rule withheld for the plan alone", async () => {
    await writeLocal(ISSUED);
    stub({ verdict: { kind: "withheld" } });
    const output = await run(["restore", RULE_ID]);
    expect(output).toMatchObject({ success: true, files: [] });
    expect(String((output.notices as string[])[0])).toContain(
      "not in your plan"
    );
    expect(restoreCalled()).toBe(false);
  });

  it("reports a locally written rule as not found, without calling restore", async () => {
    await writeLocal(ISSUED);
    stub({ verdict: { kind: "unknown" } });
    const output = await run(["restore", RULE_ID]);
    expect(output).toMatchObject({ ok: false, code: "RULE_NOT_FOUND" });
    expect(restoreCalled()).toBe(false);
  });

  it("relays a plan refusal as an answer, stripped of control characters, and writes nothing", async () => {
    await writeLocal(EDITED);
    stub({
      verdict: { kind: "unsafe", expected: await canonicalHash(ISSUED) },
      served: REFUSAL,
    });
    const output = await run(["restore", RULE_ID]);
    expect(output).toMatchObject({
      ok: false,
      code: "RULE_RECOVERY_NOT_IN_PLAN",
    });
    expect(String(output.message)).toContain("Recover it with git");
    expect(String(output.message)).toContain(REFUSAL.upgradeUrl);
    // Not in the service's message here, so the CLI adds it, once.
    expect(String(output.message).split(REFUSAL.upgradeUrl)).toHaveLength(2);
    expect(String(output.message)).not.toContain("\u001B");
    expect(await readFile(ruleFile(), "utf8")).toBe(EDITED);
  });

  it("still asks the service to restore when whoami says the plan excludes it", async () => {
    await writeLocal(EDITED);
    stub({
      verdict: { kind: "unsafe", expected: await canonicalHash(ISSUED) },
      served: REFUSAL,
      restoreRules: false,
    });
    const output = await run(["restore", RULE_ID]);
    // A hint, never a gate: the call is made and the refusal relayed.
    expect(restoreCalled()).toBe(true);
    expect(output).toMatchObject({
      ok: false,
      code: "RULE_RECOVERY_NOT_IN_PLAN",
    });
    expect(String(output.message)).toContain("Recover it with git");
  });

  it("prints the refusal to a human, not an outage", async () => {
    await writeLocal(EDITED);
    stub({
      verdict: { kind: "unsafe", expected: await canonicalHash(ISSUED) },
      served: REFUSAL,
    });
    await runCommand(ruleCommand, { rawArgs: ["restore", RULE_ID, "-d", cwd] });
    const printed = errorSpy.mock.calls
      .map((call) => String(call[0]))
      .join("\n");
    expect(printed).toContain("Recover it with git");
    expect(printed).not.toMatch(/unavailable/);
  });

  it("rollback writes the requested revision", async () => {
    await writeLocal(NEWER);
    stub({
      verdict: { kind: "run" },
      served: {
        ...(await servedBody(sgRule(ISSUED), "r1")),
        restoreRules: true,
      },
    });
    const output = await run(["rollback", RULE_ID, "r1"]);
    expect(output).toMatchObject({ success: true, revisionId: "r1" });
    expect(await readFile(ruleFile(), "utf8")).toBe(ISSUED);
    expect(calls).toContain(`POST /cli/api/v2/rule/${RULE_ID}/rollback`);
  });

  it("rollback refuses a revision other than the one requested", async () => {
    await writeLocal(NEWER);
    stub({
      verdict: { kind: "run" },
      served: {
        ...(await servedBody(sgRule(ISSUED), "r1")),
        restoreRules: true,
      },
    });
    const output = await run(["rollback", RULE_ID, "r0"]);
    expect(output).toMatchObject({ ok: false, code: "RULE_RESTORE_MISMATCH" });
    expect(await readFile(ruleFile(), "utf8")).toBe(NEWER);
  });

  it("rollback reports a foreign revision as REVISION_NOT_FOUND", async () => {
    stub({
      verdict: { kind: "run" },
      served: { error: "revision_not_found" },
      status: 404,
    });
    const output = await run(["rollback", RULE_ID, "someone-elses"]);
    expect(output).toMatchObject({ ok: false, code: "REVISION_NOT_FOUND" });
    expect(String(output.message)).toContain(`rule revisions ${RULE_ID}`);
  });

  it("rollback reports a transient outage as NETWORK_ERROR and says to try again", async () => {
    stub({ verdict: { kind: "run" }, served: {}, status: 503 });
    const output = await run(["rollback", RULE_ID, "r1"]);
    expect(output).toMatchObject({ ok: false, code: "NETWORK_ERROR" });
    expect(String(output.message)).toContain("(HTTP 503)");
    expect(String(output.message)).toContain("try again");
  });

  it("rollback reports validation_error as INVALID_INPUT with the service's details", async () => {
    stub({
      verdict: { kind: "run" },
      served: { error: "validation_error", details: ["revisionId: invalid"] },
      status: 400,
    });
    const output = await run(["rollback", RULE_ID, "r1"]);
    expect(output).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(String(output.message)).toContain("revisionId: invalid");
    expect(String(output.message)).not.toMatch(/unavailable|try again/);
  });

  it("rollback relays a plan refusal", async () => {
    stub({ verdict: { kind: "run" }, served: REFUSAL });
    const output = await run(["rollback", RULE_ID, "r1"]);
    expect(output).toMatchObject({
      ok: false,
      code: "RULE_RECOVERY_NOT_IN_PLAN",
    });
  });

  it("a runtime rule restored on a plan without runtime signatures says it will not run", async () => {
    const runtime: StubRule = {
      id: RULE_ID,
      engine: "runtime",
      files: [
        { path: "check.ts", content: "export default async () => [];\n" },
        {
          path: "captures/logs.yml",
          content:
            "id: logs\nlanguage: typescript\nrule:\n  pattern: console.log($A)\nmetadata:\n  taskless:\n    version: 1\n    kind: runtime\n    name: logs\n    check: check.ts\n    match: anchor\n",
        },
        { path: ".tests/fail/case.ts", content: "console.log(1);\n" },
      ],
    };
    stub({
      verdict: { kind: "missing", revisionId: "r1", engine: "runtime" },
      served: {
        ...(await servedBody(runtime, "r1", {
          entitlement: {
            runtimeSignatures: false,
            upgradeUrl: "https://app.taskless.io/org/1/upgrade",
          },
        })),
        restoreRules: true,
      },
    });
    const output = await run(["restore", RULE_ID]);
    expect(output).toMatchObject({ success: true, revisionId: "r1" });
    const notice = String((output.notices as string[]).at(-1));
    expect(notice).toContain("will not run");
    expect(notice).not.toContain("next `check` verifies");
  });

  it("does not repeat an upgrade link the service already wrote into the message", async () => {
    await writeLocal(EDITED);
    stub({
      verdict: { kind: "unsafe", expected: await canonicalHash(ISSUED) },
      served: {
        ...REFUSAL,
        message: `Not in your plan. See plan options at ${REFUSAL.upgradeUrl}`,
      },
    });
    const output = await run(["restore", RULE_ID]);
    expect(String(output.message).split(REFUSAL.upgradeUrl)).toHaveLength(2);
  });

  describe("rule revisions", () => {
    it("lists revisions in the service's order and marks the current one", async () => {
      stub({
        verdict: { kind: "run" },
        revisions: {
          body: listing([
            revision("r3", false),
            revision("r2", true),
            revision("r1", false),
          ]),
        },
      });
      const printed = await print();
      expect(printed.indexOf("r3")).toBeLessThan(printed.indexOf("r2"));
      expect(printed.indexOf("r2")).toBeLessThan(printed.indexOf("r1"));
      expect(currentLine(printed)).toHaveLength(1);
      expect(currentLine(printed)[0]).toContain("r2");
      expect(printed).not.toContain("Older revisions");
      expect(printed).toContain(`rule rollback ${RULE_ID} <revisionId>`);
      expect(process.exitCode).toBeUndefined();
    });

    it("on a plan known to exclude rollback, lists the same revisions and does not name rollback", async () => {
      stub({
        verdict: { kind: "run" },
        restoreRules: false,
        revisions: {
          body: listing([revision("r2", true), revision("r1", false)]),
        },
      });
      const printed = await print();
      expect(currentLine(printed)[0]).toContain("r2");
      expect(printed).toContain("r1");
      expect(printed).toContain(
        "Rolling back is not included in your organization's plan"
      );
      expect(printed).not.toContain("rule rollback");
      expect(process.exitCode).toBeUndefined();
    });

    it("on a plan known to include rollback, names rollback", async () => {
      stub({
        verdict: { kind: "run" },
        restoreRules: true,
        revisions: { body: listing([revision("r1", true)]) },
      });
      expect(await print()).toContain(`rule rollback ${RULE_ID} <revisionId>`);
    });

    it("marks a current revision appended after the newest ten by its flag", async () => {
      const newest = Array.from({ length: 10 }, (_, index) =>
        revision(`n${String(10 - index)}`, false)
      );
      stub({
        verdict: { kind: "run" },
        revisions: {
          body: listing([...newest, revision("old", true)], true),
        },
      });
      const printed = await print();
      expect(currentLine(printed)).toHaveLength(1);
      expect(currentLine(printed)[0]).toContain("old");
    });

    it("marks none for a rule that exists only on an unmerged pull request", async () => {
      const prUrl = "https://github.com/test/test/pull/7";
      stub({
        verdict: { kind: "run" },
        revisions: {
          body: listing([
            revision("r1", false, { delivery: "pull-request", prUrl }),
          ]),
        },
      });
      const printed = await print();
      expect(currentLine(printed)).toHaveLength(0);
      expect(printed).toContain(prUrl);
      expect(printed).toContain("has no current revision");
    });

    it("says when older revisions were omitted, and where to find them", async () => {
      stub({
        verdict: { kind: "run" },
        revisions: { body: listing([revision("r1", true)], true) },
      });
      expect(await print()).toContain("Taskless dashboard");
    });

    it("prints the listing under --json, without reconciling or reading the plan", async () => {
      const body = listing([revision("r2", true), revision("r1", false)]);
      stub({ verdict: { kind: "run" }, revisions: { body } });
      const output = await run(["revisions", RULE_ID]);
      expect(output).toEqual({ success: true, ...body });
      expect(process.exitCode).toBeUndefined();
      expect(calls).toContain(`GET /cli/api/v2/rule/${RULE_ID}/revisions`);
      expect(calls.some((call) => call.endsWith("/reconcile"))).toBe(false);
    });

    it("reports an unknown rule as RULE_NOT_FOUND", async () => {
      stub({
        verdict: { kind: "run" },
        revisions: { body: { error: "rule_not_found" }, status: 404 },
      });
      const output = await run(["revisions", RULE_ID]);
      expect(output).toMatchObject({ ok: false, code: "RULE_NOT_FOUND" });
      // Restore's pull-request clause does not apply: a PR-only rule is listed.
      expect(String(output.message)).not.toContain("pull request");
      expect(process.exitCode).toBe(1);
    });
  });
});
