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
import {
  DEFAULT_PROJECTION_INPUTS,
  type LocalRule,
  type ReportDraft,
} from "../src/report/draft";
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

function draftOf(rules: LocalRule[]): ReportDraft {
  return {
    producer: { kind: "cli", cliVersion: "0.12.0" },
    scope: {
      provider: "github",
      owner: "acme",
      repo: "widgets",
      url: "https://github.com/acme/widgets",
    },
    rules,
    inputs: DEFAULT_PROJECTION_INPUTS,
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
      origin: { reviewComments: 9, prs: 6 },
      fixed: 10,
      fixedBasis: "measured",
    })),
    estimates: { contextTokens: 150_000, callsPerCatch: 20 },
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

  it("normalizes per-tier counts to a 30-day month over the window", () => {
    // 2026-07-14 through 2026-10-11 inclusive is 90 days; three rules fixed
    // 10 times each is 30, so 10 a month.
    const report = assembleReport(
      draftOf(three.map((id) => localRule(id))),
      factsFor(three)
    );
    expect(report.projection.perMonth.agentCatches.cli).toBe(10);
    expect(report.projection.inputs).toMatchObject({
      contextTokens: 150_000,
      callsPerCatch: 20,
    });
  });

  it("refuses with too few local rules, cloud candidates notwithstanding", () => {
    const facts = factsFor(["a", "b"], {
      cloud: ["x", "y", "z", "w"].map((id) => ({
        id,
        title: `Cloud ${id}`,
        origin: { reviewComments: 1, prs: 1 },
        fixed: 1,
        fixedBasis: "estimated",
        language: "TypeScript",
        complexity: 3,
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
        origin: { reviewComments: 1, prs: 1 },
        fixed: 1,
        fixedBasis: "measured",
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

  it("does not gate on a small projection", () => {
    const facts = factsFor(three, {
      estimates: { contextTokens: 1, callsPerCatch: 0.1 },
    });
    expect(() =>
      assembleReport(draftOf(three.map((id) => localRule(id))), facts)
    ).not.toThrow();
  });

  it("publishes cloud candidates as runtime, untested", () => {
    const facts = factsFor(three, {
      cloud: [
        {
          id: "tenant-check",
          title: "Routes call requireTenant()",
          origin: { reviewComments: 4, prs: 3 },
          fixed: 2,
          fixedBasis: "estimated",
          language: "TypeScript",
          complexity: 4,
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
      tests: { status: "not-run" },
    });
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
