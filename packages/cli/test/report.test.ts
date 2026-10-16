import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";

import reportSchemaDocument from "../src/generated/report-v1.schema.json";
import { assembleReport } from "../src/report/assemble";
import type { LocalRule, ReportDraft } from "../src/report/draft";
import {
  reportFactsSchema,
  type ReportFacts,
} from "../src/schemas/report-facts";
import { deletePublishedReport, publishReport } from "../src/report/publish";
import { scanText } from "../src/report/redact";
import { reportSchemaIssues } from "../src/report/schema";
import { renderSummary } from "../src/report/summary";
import { CLIError } from "../src/util/cli-error";
import { builtCli } from "./support/built-cli";

const execFileAsync = promisify(execFile);

function localRule(id: string, overrides: Partial<LocalRule> = {}): LocalRule {
  return {
    id,
    engine: "sg",
    tier: "cli",
    language: "TypeScript",
    tests: { status: "pass", fail: `bad_${id}()`, pass: `good_${id}()` },
    ...overrides,
  };
}

function draftOf(
  rules: LocalRule[],
  measured: Partial<Pick<ReportDraft, "findings" | "unmeasured">> = {}
): ReportDraft {
  return {
    ...measured,
    producer: { kind: "cli", cliVersion: "0.12.0" },
    scope: {
      provider: "github",
      owner: "acme",
      repo: "widgets",
      url: "https://github.com/acme/widgets",
    },
    rules,
    missing: [],
  };
}

function factsFor(
  ids: string[],
  overrides: Partial<Record<keyof ReportFacts, unknown>> = {}
): ReportFacts {
  return reportFactsSchema.parse({
    window: { from: "2026-07-14", to: "2026-10-11" },
    history: {
      mergedPrs: 400,
      reviewComments: 2000,
      agentAssistedPrs: 200,
      patterns: { ruleShaped: 10, judgment: 3 },
    },
    rules: ids.map((id) => ({
      id,
      title: `Rule ${id}`,
      surfaced: { prs: 6, reviewComments: 9 },
    })),
    ...overrides,
  });
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof CLIError) return error.code;
    throw error;
  }
  return undefined;
}

describe("the vendored ReportV1 schema", () => {
  it("accepts its own example and rejects an unknown key", () => {
    const example = (reportSchemaDocument as { examples: unknown[] })
      .examples[0];
    expect(reportSchemaIssues(example)).toEqual([]);
    expect(
      reportSchemaIssues({ ...(example as object), surprise: true })
    ).not.toEqual([]);
  });
});

describe("the vendored delete contract", () => {
  // `deletePublishedReport` is written against this contract. A refresh that
  // changes it must fail here rather than leave the client calling a method or
  // reading a status tskl.es no longer uses.
  it("is a DELETE to the deleteUrl: 204 on success, 404 when nothing answers", () => {
    const contract = (
      reportSchemaDocument as unknown as {
        "x-taskless": {
          delete: {
            method: string;
            response: { status: number };
            errors: { not_available: { status: number } };
          };
        };
      }
    )["x-taskless"].delete;
    expect(contract.method).toBe("DELETE");
    expect(contract.response.status).toBe(204);
    expect(contract.errors.not_available.status).toBe(404);
  });
});

describe("assembleReport", () => {
  const three = ["a", "b", "c"];

  it("builds a payload the vendored schema accepts", () => {
    const report = assembleReport(
      draftOf(three.map((id) => localRule(id))),
      factsFor(three)
    );
    expect(reportSchemaIssues(report)).toEqual([]);
    expect(report.scope).toMatchObject({
      provider: "github",
      retention: "private",
    });
  });

  it("sends no value inputs, and the facts cannot supply them", () => {
    // tskl.es prices reviewer time, agent tokens, and dollars itself, and its
    // schema refuses a payload that carries a projection.
    const report = assembleReport(
      draftOf(three.map((id) => localRule(id))),
      factsFor(three)
    );
    expect(report).not.toHaveProperty("projection");
    expect(reportSchemaIssues(report)).toEqual([]);
    expect(
      reportFactsSchema.safeParse({
        ...factsFor(three),
        estimates: { contextTokens: 150_000, callsPerCatch: 20 },
      }).success
    ).toBe(false);
  });

  it("marks local rules written and carries their surfaced counts", () => {
    const report = assembleReport(
      draftOf(three.map((id) => localRule(id))),
      factsFor(three)
    );
    expect(report.rules[0]).toMatchObject({
      state: "written",
      surfaced: { prs: 6, reviewComments: 9 },
    });
  });

  it("carries the draft's measured findings on every written rule", () => {
    const report = assembleReport(
      draftOf(
        [
          localRule("a", { violations: 4, files: 2 }),
          localRule("b", { violations: 0, files: 0 }),
          localRule("c", { violations: 7, files: 3 }),
        ],
        { findings: { violations: 11, files: 4 } }
      ),
      factsFor(three)
    );
    expect(reportSchemaIssues(report)).toEqual([]);
    expect(report.findings).toEqual({ violations: 11, files: 4 });
    expect(report.rules.map((rule) => [rule.violations, rule.files])).toEqual([
      [4, 2],
      [0, 0],
      [7, 3],
    ]);
  });

  it("publishes no counts when the draft could not measure", () => {
    const report = assembleReport(
      draftOf(
        three.map((id) => localRule(id)),
        {
          unmeasured: "the scan did not complete",
        }
      ),
      factsFor(three)
    );
    expect(reportSchemaIssues(report)).toEqual([]);
    expect(report.findings).toBeUndefined();
    expect(report.rules.some((rule) => "violations" in rule)).toBe(false);
  });

  it("withdraws every count when the facts add a legacy rule", () => {
    // The CLI cannot run another linter's rule, so a total over the rules it
    // can see would silently skip one.
    const report = assembleReport(
      draftOf(
        three.map((id) => localRule(id, { violations: 1, files: 1 })),
        { findings: { violations: 3, files: 1 } }
      ),
      factsFor(three, {
        legacy: [
          {
            id: "eslint-rule",
            title: "No default exports",
            surfaced: { prs: 1, reviewComments: 1 },
            tool: "eslint",
            language: "TypeScript",
          },
        ],
      })
    );
    expect(reportSchemaIssues(report)).toEqual([]);
    expect(report.findings).toBeUndefined();
    expect(report.rules.some((rule) => "violations" in rule)).toBe(false);
    expect(report.rules.find((rule) => rule.id === "eslint-rule")?.state).toBe(
      "written"
    );
  });

  it.each([
    ["fixed", { fixed: 3 }],
    ["fixedBasis", { fixedBasis: "measured" }],
    ["origin", { origin: { reviewComments: 1, prs: 1 } }],
    ["violations", { violations: 3 }],
    ["files", { files: 1 }],
    ["state", { state: "written" }],
  ])("refuses a rule's %s in the facts", (_field, extra) => {
    const facts = {
      ...factsFor(three),
      rules: three.map((id) => ({
        id,
        title: `Rule ${id}`,
        surfaced: { prs: 1, reviewComments: 1 },
        ...extra,
      })),
    };
    expect(reportFactsSchema.safeParse(facts).success).toBe(false);
  });

  it("refuses findings in the facts", () => {
    const facts = {
      ...factsFor(three),
      findings: { violations: 342, files: 118 },
    };
    expect(reportFactsSchema.safeParse(facts).success).toBe(false);
  });

  it("refuses with too few local rules, cloud candidates notwithstanding", () => {
    const facts = factsFor(["a", "b"], {
      cloud: ["x", "y", "z", "w"].map((id) => ({
        id,
        title: `Cloud ${id}`,
        surfaced: { prs: 1, reviewComments: 1 },
        language: "TypeScript",
        estimatedViolations: 5,
      })),
    });
    let message = "";
    try {
      assembleReport(draftOf([localRule("a"), localRule("b")]), facts);
    } catch (error) {
      expect((error as CLIError).code).toBe("REPORT_INSUFFICIENT");
      message = (error as Error).message;
    }
    expect(message).toContain("2 of 3");
  });

  it("counts legacy rules the agent wrote", () => {
    const facts = factsFor(["a"], {
      legacy: ["l1", "l2"].map((id) => ({
        id,
        title: `Legacy ${id}`,
        surfaced: { prs: 1, reviewComments: 1 },
        tool: "eslint",
        language: "TypeScript",
      })),
    });
    const report = assembleReport(draftOf([localRule("a")]), facts);
    expect(report.rules.filter((rule) => rule.tier === "legacy")).toHaveLength(
      2
    );
    expect(reportSchemaIssues(report)).toEqual([]);
  });

  it("does not let a failing rule count", () => {
    const rules = [
      localRule("a"),
      localRule("b"),
      localRule("c", {
        tests: { status: "fail", fail: null, pass: null },
      }),
    ];
    expect(codeOf(() => assembleReport(draftOf(rules), factsFor(three)))).toBe(
      "REPORT_INSUFFICIENT"
    );
  });

  it("requires an estimate on every cloud candidate", () => {
    const candidate = {
      id: "tenant-check",
      title: "Routes call requireTenant()",
      surfaced: { prs: 0, reviewComments: 0 },
      language: "TypeScript",
    };
    expect(
      reportFactsSchema.safeParse({ ...factsFor(three), cloud: [candidate] })
        .success
    ).toBe(false);
    expect(
      reportFactsSchema.safeParse({
        ...factsFor(three),
        cloud: [{ ...candidate, estimatedViolations: 0 }],
      }).success
    ).toBe(true);
  });

  it("publishes cloud candidates as runtime, untested", () => {
    const facts = factsFor(three, {
      cloud: [
        {
          id: "tenant-check",
          title: "Routes call requireTenant()",
          surfaced: { prs: 3, reviewComments: 4 },
          language: "TypeScript",
          estimatedViolations: 12,
          fail: "export const GET = route(() => db.all())",
        },
      ],
    });
    const report = assembleReport(
      draftOf(three.map((id) => localRule(id))),
      facts
    );
    expect(
      report.rules.find((rule) => rule.id === "tenant-check")
    ).toMatchObject({
      tier: "cloud",
      engine: "runtime",
      state: "candidate",
      estimatedViolations: 12,
      tests: { status: "not-run" },
    });
    // The estimate belongs to the candidate alone; written rules carry the
    // measured `violations` instead.
    for (const rule of report.rules.filter(
      (rule) => rule.state === "written"
    )) {
      expect(rule).not.toHaveProperty("estimatedViolations");
    }
    expect(reportSchemaIssues(report)).toEqual([]);
  });

  it("refuses facts for a rule the CLI does not have", () => {
    expect(
      codeOf(() =>
        assembleReport(
          draftOf(three.map((id) => localRule(id))),
          factsFor([...three, "ghost"])
        )
      )
    ).toBe("REPORT_INVALID");
  });

  it("refuses a per-month figure in the facts", () => {
    const result = reportFactsSchema.safeParse({
      ...factsFor(three),
      perMonth: { agentCatches: { cli: 999, cloud: 0 } },
    });
    expect(result.success).toBe(false);
  });

  it("withholds a fixture holding a secret, whole", () => {
    const secret = "const key = 'AKIAIOSFODNN7EXAMPLE';";
    const rules = [
      localRule("a", { tests: { status: "pass", fail: secret, pass: "ok()" } }),
      localRule("b"),
      localRule("c"),
    ];
    const report = assembleReport(draftOf(rules), factsFor(three));
    const a = report.rules.find((rule) => rule.id === "a");
    expect(a?.tests.fail).toBeNull();
    expect(a?.tests.withheld).toEqual(["fail"]);
    expect(report.redaction.counts.secret).toBe(1);
    expect(report.redaction.withheldFixtures).toBe(1);
    expect(JSON.stringify(report)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("refuses an email address in a title", () => {
    const facts = factsFor(three);
    facts.rules[0]!.title = "Ask jane@acme.io before merging";
    expect(
      codeOf(() =>
        assembleReport(draftOf(three.map((id) => localRule(id))), facts)
      )
    ).toBe("REPORT_REDACTION");
  });

  it("refuses a match in a legacy or cloud rule's other strings, naming the field", () => {
    const legacy = {
      id: "l1",
      title: "Legacy l1",
      surfaced: { prs: 1, reviewComments: 1 },
      tool: "eslint",
      language: "TypeScript",
    };
    const cloud = {
      id: "c1",
      title: "Cloud c1",
      surfaced: { prs: 1, reviewComments: 1 },
      language: "TypeScript",
      estimatedViolations: 3,
    };
    const cases: [string, Partial<ReportFacts>][] = [
      [
        "legacy[l1].tool",
        { legacy: [{ ...legacy, tool: "jane@acme.io" }], cloud: [] },
      ],
      [
        "legacy[l1].language",
        { legacy: [{ ...legacy, language: "TS for api.acme.io" }], cloud: [] },
      ],
      [
        "cloud[c1].language",
        { legacy: [], cloud: [{ ...cloud, language: "jane@acme.io" }] },
      ],
      [
        "cloud[api.acme.io].id",
        { legacy: [], cloud: [{ ...cloud, id: "api.acme.io" }] },
      ],
    ];
    for (const [field, extra] of cases) {
      let refusal: unknown;
      try {
        assembleReport(
          draftOf(three.map((id) => localRule(id))),
          factsFor(three, extra)
        );
      } catch (error) {
        refusal = error;
      }
      expect((refusal as CLIError).code, field).toBe("REPORT_REDACTION");
      expect((refusal as Error).message, field).toContain(field);
    }
  });

  it("carries the agent's own redaction counts and withholdings", () => {
    const facts = factsFor(three, {
      redaction: {
        counts: { person: 2 },
        withheld: [{ id: "b", side: "pass" }],
      },
    });
    const report = assembleReport(
      draftOf(three.map((id) => localRule(id))),
      facts
    );
    expect(report.redaction.counts.person).toBe(2);
    expect(report.rules.find((rule) => rule.id === "b")?.tests).toMatchObject({
      pass: null,
      withheld: ["pass"],
    });
  });
});

describe("scanText", () => {
  it("ignores documentation hosts and ordinary member access", () => {
    expect(
      scanText(
        "fetch('https://api.example.com'); this.app.listen(); res.json()"
      )
    ).toEqual({});
  });

  it("finds a real host, an IP, and a phone number", () => {
    expect(scanText("db.internal 10.2.3.4 call (415) 555-0100")).toMatchObject({
      host: 1,
      ip: 1,
      phone: 1,
    });
  });
});

function summaryOf(draft: ReportDraft): string {
  return renderSummary({
    report: assembleReport(draft, factsFor(["a", "b", "c"])),
    url: "https://tskl.es/r/abc",
    expiresAt: "2026-11-12T00:00:00Z",
    record: "2026-10-13_142200.json",
    invocation: "npx @taskless/cli",
  });
}

describe("renderSummary", () => {
  it("names each rule and the link, and never the delete URL", () => {
    const report = assembleReport(
      draftOf(["a", "b", "c"].map((id) => localRule(id))),
      factsFor(["a", "b", "c"])
    );
    const summary = renderSummary({
      report,
      url: "https://tskl.es/r/abc",
      expiresAt: "2026-11-12T00:00:00Z",
      record: "2026-10-13_142200.json",
      invocation: "npx @taskless/cli",
    });
    expect(summary).toContain("Rule a (Taskless ast-grep rule)");
    expect(summary).toContain("https://tskl.es/r/abc");
    expect(summary).toContain("can be deleted after review");
    expect(summary).not.toContain("delete/");
  });

  it("leads with what the rules found today, apart from review history", () => {
    const summary = summaryOf(
      draftOf(
        ["a", "b", "c"].map((id) =>
          localRule(id, { violations: 114, files: 40 })
        ),
        { findings: { violations: 342, files: 118 } }
      )
    );
    expect(summary).toContain(
      "Found in the code today: 342 problems in 118 files."
    );
    expect(summary).toContain(
      "Raised in review from 2026-07-14 to 2026-10-11: 27 comments across 18 pull requests."
    );
    expect(summary).not.toMatch(/month/i);
  });

  it("states no problem count it does not have", () => {
    const summary = summaryOf(
      draftOf(["a", "b", "c"].map((id) => localRule(id)))
    );
    expect(summary).not.toContain("Found in the code today");
    expect(summary).toContain("Raised in review");
  });
});

interface FakeResponse {
  status: number;
  body?: unknown;
}

/**
 * A stand-in for tskl.es. `answer` decides each response from the request and
 * the fake's own base URL; every request is recorded.
 */
async function fakeTsklEs(
  answer: (
    request: { method: string; url: string },
    base: string
  ) => FakeResponse
): Promise<{
  server: Server;
  url: string;
  requests: Array<{ method: string; url: string; body: string }>;
}> {
  const requests: Array<{ method: string; url: string; body: string }> = [];
  let base = "";
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const seen = { method: request.method ?? "", url: request.url ?? "" };
      requests.push({ ...seen, body });
      const next = answer(seen, base);
      response.writeHead(next.status, { "content-type": "application/json" });
      response.end(next.body === undefined ? "" : JSON.stringify(next.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${String(port)}`;
  return { server, url: base, requests };
}

/** Answers from a fixed script, in order. */
function scripted(responses: FakeResponse[]) {
  return () => responses.shift() ?? { status: 500 };
}

describe("publishReport", () => {
  const original = { ...process.env };
  let server: Server | undefined;

  afterEach(async () => {
    process.env = { ...original };
    if (server) await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  });

  const created = {
    status: 201,
    body: {
      url: "https://tskl.es/r/abc",
      deleteUrl: "https://tskl.es/api/v1/reports/abc/key",
      expiresAt: "2026-11-12T00:00:00Z",
    },
  };

  it("retries a 502 and succeeds", async () => {
    const fake = await fakeTsklEs(scripted([{ status: 502 }, created]));
    server = fake.server;
    process.env.TASKLESS_REPORT_URL = `${fake.url}/api/v1/reports`;
    process.env.TASKLESS_REPORT_BACKOFF_MS = "1";

    await expect(publishReport("{}")).resolves.toMatchObject({
      url: "https://tskl.es/r/abc",
    });
    expect(fake.requests).toHaveLength(2);
  });

  it("surfaces a rate limit without retrying", async () => {
    const fake = await fakeTsklEs(scripted([{ status: 429 }, created]));
    server = fake.server;
    process.env.TASKLESS_REPORT_URL = `${fake.url}/api/v1/reports`;

    await expect(publishReport("{}")).rejects.toMatchObject({
      code: "REPORT_RATE_LIMITED",
    });
    expect(fake.requests).toHaveLength(1);
  });

  it("does not retry a dropped connection", async () => {
    // A port nothing listens on: the request fails before any response, which
    // is the case where a report may or may not exist.
    const fake = await fakeTsklEs(scripted([]));
    const closedUrl = `${fake.url}/api/v1/reports`;
    await new Promise((resolve) => fake.server.close(resolve));
    process.env.TASKLESS_REPORT_URL = closedUrl;

    await expect(publishReport("{}")).rejects.toMatchObject({
      code: "REPORT_PUBLISH_UNKNOWN",
    });
  });
});

/** The report records under `.taskless/reports/`, the stub README excluded. */
async function recordsIn(cwd: string): Promise<string[]> {
  const names = await readdir(join(cwd, ".taskless", "reports"));
  return names.filter((name) => name.endsWith(".json"));
}

describe("deletePublishedReport", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  });

  it("resolves on a 204", async () => {
    const fake = await fakeTsklEs(scripted([{ status: 204 }]));
    server = fake.server;
    await expect(
      deletePublishedReport(`${fake.url}/api/v1/reports/abc/key`)
    ).resolves.toBeUndefined();
    expect(fake.requests[0]).toMatchObject({ method: "DELETE" });
  });

  it("reports a 404 as not available, once", async () => {
    const fake = await fakeTsklEs(scripted([{ status: 404 }, { status: 204 }]));
    server = fake.server;
    await expect(
      deletePublishedReport(`${fake.url}/api/v1/reports/abc/key`)
    ).rejects.toMatchObject({ code: "REPORT_NOT_AVAILABLE" });
    // Not retryable, per the contract.
    expect(fake.requests).toHaveLength(1);
  });
});

/** End to end, through the built CLI, against a fake tskl.es. */
describe("taskless report", () => {
  const binPath = builtCli();
  let cwd: string;
  let server: Server | undefined;

  async function run(
    args: string[],
    env: Record<string, string> = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await execFileAsync(
        "node",
        [binPath, ...args, "-d", cwd],
        {
          env: {
            ...process.env,
            DO_NOT_TRACK: "1",
            TASKLESS_TELEMETRY_DISABLED: "1",
            ...env,
          },
        }
      );
      return { stdout, stderr, exitCode: 0 };
    } catch (error) {
      const failure = error as {
        stdout?: string;
        stderr?: string;
        code?: number;
      };
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
        exitCode: failure.code ?? 1,
      };
    }
  }

  async function sgRule(id: string): Promise<void> {
    const directory = join(cwd, ".taskless", "rules", "sg", id);
    await mkdir(join(directory, ".tests"), { recursive: true });
    await writeFile(
      join(directory, `${id}.yml`),
      stringify({
        id,
        language: "TypeScript",
        severity: "error",
        message: `no ${id}`,
        rule: { pattern: `${id}($$$)` },
      })
    );
    await writeFile(
      join(directory, ".tests", `${id}-test.yml`),
      stringify({ id, valid: ["const a = 1;"], invalid: [`${id}(x);`] })
    );
  }

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "tskl-report-"));
    await run(["init"]);
    for (const id of ["alpha", "beta", "gamma"]) await sgRule(id);
    // Three matches across two files: alpha twice in one, beta once in each
    // file, gamma nowhere.
    await writeFile(join(cwd, "one.ts"), "alpha(1);\nalpha(2);\nbeta(3);\n");
    await writeFile(join(cwd, "two.ts"), "beta(4);\n");
  });

  afterEach(async () => {
    if (server) await new Promise((resolve) => server!.close(resolve));
    server = undefined;
    await rm(cwd, { recursive: true, force: true });
  });

  it("drafts offline, listing every rule and what is missing", async () => {
    const { stdout, exitCode } = await run(["report"], {
      TASKLESS_REPORT_URL: "http://127.0.0.1:9/unreachable",
    });
    expect(exitCode).toBe(0);
    const draft = JSON.parse(stdout) as ReportDraft;
    expect(draft.rules.map((rule) => rule.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(draft.rules.every((rule) => rule.tests.status === "pass")).toBe(
      true
    );
    expect(draft.scope.provider).toBe("none");
    expect(draft.findings).toEqual({ violations: 4, files: 2 });
    expect(
      draft.rules.map((rule) => [rule.id, rule.violations, rule.files])
    ).toEqual([
      ["alpha", 2, 1],
      ["beta", 2, 2],
      ["gamma", 0, 0],
    ]);
    expect(draft.missing).toContain("history");
    expect(draft.missing).toContain("rules[alpha]");
  });

  it("publishes, records, summarizes, and deletes", async () => {
    const fake = await fakeTsklEs((request, base) =>
      request.method === "POST"
        ? {
            status: 201,
            body: {
              url: "https://tskl.es/r/abc",
              deleteUrl: `${base}/api/v1/reports/abc/secret-key`,
              expiresAt: "2026-11-12T00:00:00Z",
            },
          }
        : { status: 204 }
    );
    server = fake.server;
    const deleteUrl = `${fake.url}/api/v1/reports/abc/secret-key`;

    const factsPath = join(cwd, ".taskless", ".tmp-report.json");
    await writeFile(
      factsPath,
      JSON.stringify(factsFor(["alpha", "beta", "gamma"])),
      "utf8"
    );
    const env = { TASKLESS_REPORT_URL: `${fake.url}/api/v1/reports` };

    const published = await run(["report", "--from", factsPath], env);
    expect(published.exitCode).toBe(0);
    expect(published.stdout).toContain("https://tskl.es/r/abc");
    expect(published.stdout).toContain("can be deleted after review");
    expect(published.stdout).not.toContain("secret-key");

    const sent = JSON.parse(fake.requests[0]!.body) as Record<string, unknown>;
    expect(reportSchemaIssues(sent)).toEqual([]);
    expect(sent.findings).toEqual({ violations: 4, files: 2 });
    expect(published.stdout).toContain(
      "Found in the code today: 4 problems in 2 files."
    );

    const records = await recordsIn(cwd);
    expect(records).toHaveLength(1);
    const record = JSON.parse(
      await readFile(join(cwd, ".taskless", "reports", records[0]!), "utf8")
    ) as { deleteUrl: string };
    expect(record.deleteUrl).toBe(deleteUrl);

    const deleted = await run(["report", "--delete", records[0]!], env);
    expect(deleted.exitCode).toBe(0);
    expect(fake.requests.at(-1)).toMatchObject({
      method: "DELETE",
      url: "/api/v1/reports/abc/secret-key",
    });
    await expect(recordsIn(cwd)).resolves.toEqual([]);
  });

  it("refuses too few rules without touching the network", async () => {
    await rm(join(cwd, ".taskless", "rules", "sg", "gamma"), {
      recursive: true,
    });
    const factsPath = join(cwd, ".taskless", ".tmp-report.json");
    await writeFile(
      factsPath,
      JSON.stringify(factsFor(["alpha", "beta"])),
      "utf8"
    );
    const { stderr, exitCode } = await run(["report", "--from", factsPath], {
      TASKLESS_REPORT_URL: "http://127.0.0.1:9/unreachable",
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("REPORT_INSUFFICIENT");
  });

  it("reports a missing record", async () => {
    const { stderr, exitCode } = await run(["report", "--delete", "nope.json"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("REPORT_NOT_FOUND");
  });

  it("refuses a record outside .taskless/reports/", async () => {
    for (const record of [
      "../outside.json",
      "/tmp/outside.json",
      "notes.txt",
    ]) {
      const { stderr, exitCode } = await run(["report", "--delete", record]);
      expect(exitCode, record).not.toBe(0);
      expect(stderr, record).toContain("INVALID_INPUT");
    }
  });

  // #520: review comments are the only thing `surfaced` counts, and value is
  // tskl.es's to estimate. The agent supplies a candidate's instances and no
  // pricing input at all.
  it("counts only review comments, and asks for a candidate estimate, not pricing", async () => {
    const { stdout, exitCode } = await run(["agent", "report"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^# Topic: report {5}\(CLI v.+ \/ topic v3\)/m);
    const flat = stdout.replaceAll(/\s+/g, " ");
    const counting = flat.slice(flat.indexOf("## Counting surfaced"));
    expect(counting).toContain("**Only review comments count.**");
    expect(counting).toContain(
      "A fix-up commit, a `git blame` date, or a finding in the code today is not a review comment"
    );
    const supply = flat.slice(
      flat.indexOf("**Supply what is missing.**"),
      flat.indexOf("**Generate.**")
    );
    expect(supply).toContain("`estimatedViolations`");
    expect(supply).not.toContain("contextTokens");
    expect(supply).not.toContain("callsPerCatch");
    const show = flat.slice(
      flat.indexOf("**Show the result.**"),
      flat.indexOf("**Clean up.**")
    );
    expect(show).toContain("which are **your estimate**");
  });

  it("refuses --from and --delete together", async () => {
    const { stderr, exitCode } = await run([
      "report",
      "--from",
      "x.json",
      "--delete",
      "y.json",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("INVALID_INPUT");
  });
});
