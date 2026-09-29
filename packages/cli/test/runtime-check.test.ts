import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateFixture } from "./support/current-project";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

interface ReportedRule {
  ruleId: string;
  files: { path: string; signature: string }[];
}
interface ReconcileRequestBody {
  repositoryUrl: string;
  rules: ReportedRule[];
}
type Responder = (request: ReconcileRequestBody) => {
  statusCode: number;
  body?: unknown;
};
interface MockServer {
  apiUrl: string;
  requests: ReconcileRequestBody[];
  /** Every path requested, so a test can assert nothing but reconcile was called. */
  paths: string[];
  headers: Record<string, string | string[] | undefined>[];
  close: () => Promise<void>;
}

/** Start a mock v2 reconcile endpoint on a random port. */
function startMockServer(responder: Responder): Promise<MockServer> {
  const requests: ReconcileRequestBody[] = [];
  const paths: string[] = [];
  const headers: Record<string, string | string[] | undefined>[] = [];
  const server: Server = createServer((request, response) => {
    paths.push(`${request.method ?? ""} ${request.url ?? ""}`);
    if (request.method !== "POST" || request.url !== "/cli/api/v2/reconcile") {
      response.writeHead(404).end("{}");
      return;
    }
    let raw = "";
    request.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    request.on("end", () => {
      const parsed = JSON.parse(raw) as ReconcileRequestBody;
      requests.push(parsed);
      headers.push(request.headers);
      const { statusCode, body } = responder(parsed);
      response.writeHead(statusCode, { "content-type": "application/json" });
      response.end(JSON.stringify(body ?? {}));
    });
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({
        apiUrl: `http://127.0.0.1:${String(port)}/cli`,
        requests,
        paths,
        headers,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/**
 * Every call except the identity lookup, which resolves the org subject and is
 * not a data route: the assertion is that nothing but reconcile touched rules.
 */
function dataCalls(server: MockServer): string[] {
  return server.paths.filter((path) => !path.endsWith("/whoami"));
}

const ENGINES: Record<string, string> = {
  "no-console": "sg",
  demo: "runtime",
  other: "runtime",
  broken: "runtime",
};

type Answer =
  | "run"
  | "unknown"
  | "withheld"
  | "omit"
  | { unsafe: { path: string; expected?: string; got?: string }[] };

const UPGRADE_URL = "https://app.taskless.io/o/acme/upgrade?from=reconcile";

/**
 * A v2 reconcile answer: each reported rule gets the verdict \`answers\` names,
 * \`unknown\` by default. \`withheld\` rules make the organization unentitled.
 */
function answer(
  request: ReconcileRequestBody,
  answers: Record<string, Answer> = {},
  extra: {
    missing?: { ruleId: string; engine: string; revisionId: string }[];
  } = {}
) {
  const rules: unknown[] = [];
  const unknown: { ruleId: string }[] = [];
  const withheld: { ruleId: string; revisionId: string }[] = [];
  for (const { ruleId } of request.rules) {
    const verdict = answers[ruleId] ?? "unknown";
    const engine = ENGINES[ruleId] ?? "sg";
    switch (verdict) {
      case "omit": {
        break;
      }
      case "unknown": {
        unknown.push({ ruleId });
        break;
      }
      case "withheld": {
        withheld.push({ ruleId, revisionId: "rev-1" });
        break;
      }
      case "run": {
        rules.push({ ruleId, engine, verdict: "run", revisionId: "rev-1" });
        break;
      }
      default: {
        rules.push({
          ruleId,
          engine,
          verdict: "unsafe",
          files: verdict.unsafe,
        });
      }
    }
  }
  for (const missing of extra.missing ?? []) {
    rules.push({ ...missing, verdict: "missing" });
  }
  return {
    rules,
    unknown,
    entitlement:
      withheld.length === 0
        ? { runtimeSignatures: true }
        : {
            runtimeSignatures: false,
            reason: "RUNTIME_SIGNATURES_NOT_IN_PLAN",
            upgradeUrl: UPGRADE_URL,
            withheld,
          },
  };
}

/** A digest of every file under \`.taskless/rules/\`, to prove \`check\` wrote nothing there. */
async function treeDigest(directory: string): Promise<string> {
  const root = join(directory, ".taskless", "rules");
  const hash = createHash("sha256");
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted();
  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

async function runCli(
  args: string[],
  env: Record<string, string> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await migrateFixture(args);

  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args], {
      env: { ...process.env, ...env },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const execError = error as { stdout: string; stderr: string; code: number };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: execError.code,
    };
  }
}

/** The check `--json` line, ignoring any preceding migration output. */
interface CheckJson {
  success: boolean;
  results: { source: string; ruleId: string }[];
  skipped?: { rule: string; reason: string }[];
  failures?: string[];
  notices?: string[];
  integrity?: {
    ruleId: string;
    engine?: string;
    verdict: string;
    files?: unknown[];
    revisionId?: string;
  }[];
  entitlement?: {
    runtimeSignatures: false;
    reason?: string;
    upgradeUrl?: string;
    withheld: string[];
  };
}

function parseJson(stdout: string): CheckJson {
  const line = stdout
    .trim()
    .split("\n")
    .findLast((l) => l.trim().startsWith("{"));
  return JSON.parse(line ?? "{}") as CheckJson;
}

const STATIC_RULE = [
  "id: no-console",
  "language: typescript",
  "severity: warning",
  "rule:",
  "  pattern: console.log($$$A)",
  "message: avoid console.log",
  "",
].join("\n");

const RUNTIME_CAPTURE = [
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

const RUNTIME_CHECK = `export default async function (root, matches) {
  return matches.map((m) => ({ file: m.file, line: m.line, message: "runtime " + m.rule, severity: "warning" }));
}
`;

describe("check: static vs runtime dispatch", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tskl-rt-check-"));
    const rules = join(directory, ".taskless", "sg", "rules");
    const runtime = join(directory, ".taskless", "runtime", "rules", "demo");
    await mkdir(rules, { recursive: true });
    await mkdir(runtime, { recursive: true });
    await writeFile(join(rules, "no-console.yml"), STATIC_RULE, "utf8");
    await writeFile(join(runtime, "logs.yml"), RUNTIME_CAPTURE, "utf8");
    await writeFile(join(runtime, "check.ts"), RUNTIME_CHECK, "utf8");
    await writeFile(join(directory, "src.ts"), 'console.log("hi");\n', "utf8");
    await execFileAsync("git", ["init"], { cwd: directory });
    await execFileAsync(
      "git",
      ["remote", "add", "origin", "https://github.com/acme/widgets.git"],
      { cwd: directory }
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("logged out: static runs, runtime is skipped and reported in --json", async () => {
    const { stdout, exitCode } = await runCli([
      "check",
      "-d",
      directory,
      "--json",
    ]);
    const output = parseJson(stdout);
    expect(exitCode).toBe(0); // only warnings
    const ids = new Set(output.results.map((r) => r.ruleId));
    expect(ids.has("no-console")).toBe(true); // static always runs
    expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
      false
    );
    expect(output.skipped?.some((s) => s.rule === "demo")).toBe(true);
  });

  it("logged out: skip notice on stderr, static findings on stdout", async () => {
    const { stdout, stderr } = await runCli(["check", "-d", directory]);
    expect(stderr).toContain("was not run");
    expect(stdout).toContain("no-console");
  });

  /** Run \`check\` authenticated against a mock that answers with \`responder\`. */
  async function authedCheck(
    responder: Responder,
    extraArguments: string[] = ["--json"]
  ) {
    const server = await startMockServer(responder);
    try {
      const result = await runCli(
        ["check", "-d", directory, ...extraArguments],
        {
          TASKLESS_TOKEN: "fake.token",
          TASKLESS_API_URL: server.apiUrl,
        }
      );
      return { ...result, server };
    } finally {
      await server.close();
    }
  }

  it("reports every rule directory of every engine, files relative, fixtures excluded", async () => {
    await migrateFixture(["-d", directory]);
    const fixtures = join(
      directory,
      ".taskless",
      "rules",
      "runtime",
      "demo",
      ".tests"
    );
    await mkdir(fixtures, { recursive: true });
    await writeFile(join(fixtures, "case.ts"), "console.log(1);\n");
    const { server } = await authedCheck((request) => ({
      statusCode: 200,
      body: answer(request, { "no-console": "run", demo: "run" }),
    }));
    expect(dataCalls(server)).toEqual(["POST /cli/api/v2/reconcile"]);
    const rules = server.requests[0]!.rules;
    const byId = Object.fromEntries(
      rules.map((rule) => [rule.ruleId, rule.files.map((file) => file.path)])
    );
    expect(byId).toEqual({
      "no-console": ["no-console.yml"],
      demo: ["captures/logs.yml", "check.ts"],
    });
    for (const rule of rules) {
      for (const file of rule.files) {
        expect(file.signature).toMatch(/^1;h=sha-256;d=[0-9a-f]{64}$/);
      }
    }
    const version = server.headers[0]?.["x-taskless-cli-version"];
    expect(typeof version).toBe("string");
    expect(version).not.toBe("");
  });

  it("run for every rule: runtime executes and static runs, from the snapshot", async () => {
    const { stdout, exitCode } = await authedCheck((request) => ({
      statusCode: 200,
      body: answer(request, { "no-console": "run", demo: "run" }),
    }));
    const output = parseJson(stdout);
    expect(exitCode).toBe(0);
    expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
      true
    );
    expect(output.results.some((r) => r.ruleId === "no-console")).toBe(true);
    expect(output).not.toHaveProperty("integrity");
  });

  it("unknown: a local static rule runs silently, a local runtime rule does not execute", async () => {
    const { stdout, stderr, exitCode } = await authedCheck(
      (request) => ({ statusCode: 200, body: answer(request) }),
      []
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("no-console");
    expect(stderr).not.toMatch(/no-console/);
    expect(stderr).toMatch(
      /runtime rule demo was not run — not issued by the rule service/
    );
  });

  it("an edited static rule does not run, fails the run, and names restore", async () => {
    await migrateFixture(["-d", directory]);
    const before = await treeDigest(directory);
    const { stdout, exitCode } = await authedCheck((request) => ({
      statusCode: 200,
      body: answer(request, {
        demo: "run",
        "no-console": {
          unsafe: [
            {
              path: "no-console.yml",
              expected: "1;h=sha-256;d=00",
              got: "1;h=sha-256;d=11",
            },
          ],
        },
      }),
    }));
    const output = parseJson(stdout);
    expect(exitCode).toBe(1);
    expect(output.success).toBe(false);
    expect(output.results.some((r) => r.ruleId === "no-console")).toBe(false);
    expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
      true
    );
    expect(output.failures?.join("\n")).toMatch(
      /sg rule no-console was edited .*changed no-console\.yml.*rule restore no-console/
    );
    expect(output.integrity).toEqual([
      {
        ruleId: "no-console",
        engine: "sg",
        verdict: "unsafe",
        files: [
          {
            path: "no-console.yml",
            expected: "1;h=sha-256;d=00",
            got: "1;h=sha-256;d=11",
          },
        ],
      },
    ]);
    // `check` never writes the rules tree, even to repair.
    expect(await treeDigest(directory)).toBe(before);
  });

  it("an edited runtime rule does not execute and does not fail the run", async () => {
    const { stdout, exitCode } = await authedCheck((request) => ({
      statusCode: 200,
      body: answer(request, {
        "no-console": "run",
        demo: {
          unsafe: [{ path: "captures/extra.yml", got: "1;h=sha-256;d=22" }],
        },
      }),
    }));
    const output = parseJson(stdout);
    expect(exitCode).toBe(0);
    expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
      false
    );
    expect(output.skipped?.find((s) => s.rule === "demo")?.reason).toMatch(
      /edited .*added captures\/extra\.yml/
    );
    expect(output.notices?.join("\n")).toMatch(/rule restore demo/);
  });

  it("missing warns, names restore, and fetches nothing", async () => {
    const { stdout, exitCode, server } = await authedCheck((request) => ({
      statusCode: 200,
      body: answer(
        request,
        { "no-console": "run", demo: "run" },
        {
          missing: [
            { ruleId: "gone-3fa9c21b", engine: "vale", revisionId: "rev-9" },
          ],
        }
      ),
    }));
    const output = parseJson(stdout);
    expect(exitCode).toBe(0);
    expect(dataCalls(server)).toEqual(["POST /cli/api/v2/reconcile"]);
    expect(output.integrity).toEqual([
      {
        ruleId: "gone-3fa9c21b",
        engine: "vale",
        verdict: "missing",
        revisionId: "rev-9",
      },
    ]);
    expect(output.notices?.join("\n")).toMatch(/rule restore gone-3fa9c21b/);
  });

  it("a reported rule the answer does not account for does not run and fails the run", async () => {
    const { stdout, exitCode } = await authedCheck((request) => ({
      statusCode: 200,
      body: answer(request, { "no-console": "run", demo: "omit" }),
    }));
    const output = parseJson(stdout);
    expect(exitCode).toBe(1);
    expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
      false
    );
    expect(output.integrity).toEqual([
      { ruleId: "demo", engine: "runtime", verdict: "unaccounted" },
    ]);
  });

  it("an id shared across engines stops the run before reconcile", async () => {
    const decoy = join(directory, ".taskless", "rules", "sg", "demo");
    await migrateFixture(["-d", directory]);
    await mkdir(decoy, { recursive: true });
    await writeFile(
      join(decoy, "demo.yml"),
      STATIC_RULE.replace("no-console", "demo")
    );
    const { stdout, exitCode, server } = await authedCheck((request) => ({
      statusCode: 200,
      body: answer(request, { "no-console": "run", demo: "run" }),
    }));
    const output = parseJson(stdout);
    expect(exitCode).toBe(1);
    expect(server.requests).toHaveLength(0);
    expect(output.results.some((r) => r.ruleId === "demo")).toBe(false);
    expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
      false
    );
    expect(output.failures?.join("\n")).toMatch(
      /\.taskless\/rules\/sg\/demo\/.*\.taskless\/rules\/runtime\/demo\//
    );
  });

  it("reconcile unavailable: runtime skipped, static runs, exit 0, and it says so", async () => {
    const { stdout, exitCode } = await authedCheck(() => ({ statusCode: 503 }));
    const output = parseJson(stdout);
    expect(exitCode).toBe(0);
    expect(output.results.some((r) => r.ruleId === "no-console")).toBe(true);
    expect(output.skipped?.some((s) => s.rule === "demo")).toBe(true);
    expect(output.notices?.join("\n")).toMatch(
      /verification could not be performed/
    );
  });

  it("--anonymous with a token: skips runtime and never calls reconcile", async () => {
    const { stdout, server } = await authedCheck(
      (request) => ({ statusCode: 200, body: answer(request) }),
      ["--json", "--anonymous"]
    );
    expect(dataCalls(server)).toHaveLength(0);
    expect(parseJson(stdout).skipped?.some((s) => s.rule === "demo")).toBe(
      true
    );
  });

  it("--dangerously-run-scripts while authenticated: no reconcile, no checksums, everything runs", async () => {
    const { stdout, server } = await authedCheck(
      (request) => ({
        statusCode: 200,
        body: answer(request, { "no-console": { unsafe: [] } }),
      }),
      ["--json", "--dangerously-run-scripts"]
    );
    expect(dataCalls(server)).toHaveLength(0);
    const output = parseJson(stdout);
    expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
      true
    );
    expect(output.results.some((r) => r.ruleId === "no-console")).toBe(true);
  });

  it("--dangerously-run-scripts: runs runtime offline behind a warning", async () => {
    const { stdout, stderr } = await runCli([
      "check",
      "-d",
      directory,
      "--dangerously-run-scripts",
    ]);
    const warningLines = stderr
      .split("\n")
      .filter((line) => line.includes("dangerously-run-scripts"));
    expect(warningLines.length).toBeGreaterThan(0);
    for (const line of warningLines) {
      expect(line.startsWith("Notice: ")).toBe(true);
    }
    expect(stdout).toContain("demo");
  });

  it("a malformed runtime rule is reported and skipped, never fatal", async () => {
    await migrateFixture(["-d", directory]);
    const broken = join(directory, ".taskless", "rules", "runtime", "broken");
    await mkdir(join(broken, "captures"), { recursive: true });
    await writeFile(
      join(broken, "captures", "logs.yml"),
      RUNTIME_CAPTURE,
      "utf8"
    );
    const { stdout, exitCode, server } = await authedCheck((request) => ({
      statusCode: 200,
      body: answer(request, { "no-console": "run", demo: "run" }),
    }));
    const output = parseJson(stdout);
    expect(exitCode).toBe(0);
    expect(server.requests[0]!.rules.map((rule) => rule.ruleId)).toContain(
      "broken"
    );
    expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
      true
    );
    expect(output.skipped?.some((s) => s.rule === "broken")).toBe(true);
  });

  it("withheld for the plan: fails the run and names the cause, not drift", async () => {
    const { stdout, exitCode } = await authedCheck((request) => ({
      statusCode: 200,
      body: answer(request, { "no-console": "run", demo: "withheld" }),
    }));
    const output = parseJson(stdout);
    expect(exitCode).toBe(1);
    expect(output.success).toBe(false);
    expect(output.results.some((r) => r.ruleId === "no-console")).toBe(true);
    expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
      false
    );
    const skip = output.skipped?.find((s) => s.rule === "demo");
    expect(skip?.reason).toBe("not included in your Taskless plan");
    expect(output.entitlement).toEqual({
      runtimeSignatures: false,
      reason: "RUNTIME_SIGNATURES_NOT_IN_PLAN",
      upgradeUrl: UPGRADE_URL,
      withheld: ["demo"],
    });
    expect(output).not.toHaveProperty("integrity");
  });

  it("withheld for the plan, human output: one notice carries the upgrade URL", async () => {
    const { stderr, exitCode } = await authedCheck(
      (request) => ({
        statusCode: 200,
        body: answer(request, { "no-console": "run", demo: "withheld" }),
      }),
      []
    );
    expect(exitCode).toBe(1);
    expect(stderr.split(UPGRADE_URL)).toHaveLength(2);
    expect(stderr).toContain("RUNTIME_SIGNATURES_NOT_IN_PLAN");
    expect(stderr).not.toMatch(/restore demo/);
  });

  it("run and withheld together: the run rule executes and the run still fails", async () => {
    await migrateFixture(["-d", directory]);
    const other = join(directory, ".taskless", "rules", "runtime", "other");
    await mkdir(join(other, "captures"), { recursive: true });
    await writeFile(
      join(other, "captures", "logs.yml"),
      RUNTIME_CAPTURE,
      "utf8"
    );
    await writeFile(join(other, "check.ts"), RUNTIME_CHECK + "// other\n");
    const { stdout, exitCode } = await authedCheck((request) => ({
      statusCode: 200,
      body: answer(request, {
        "no-console": "run",
        demo: "run",
        other: "withheld",
      }),
    }));
    const output = parseJson(stdout);
    expect(exitCode).toBe(1);
    expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
      true
    );
    expect(output.entitlement?.withheld).toEqual(["other"]);
  });

  it("an entitled organization: exit 0 and no entitlement field", async () => {
    const { stdout, exitCode } = await authedCheck((request) => ({
      statusCode: 200,
      body: answer(request, { "no-console": "run", demo: "run" }),
    }));
    expect(exitCode).toBe(0);
    expect(parseJson(stdout)).not.toHaveProperty("entitlement");
  });

  it("--preserve-logs keeps an authenticated run's logs, and no log holds the token", async () => {
    const { stdout } = await authedCheck(
      (request) => ({
        statusCode: 200,
        body: answer(request, { "no-console": "run", demo: "run" }),
      }),
      ["--json", "--preserve-logs"]
    );
    const output = parseJson(stdout) as CheckJson & { runDirectory?: string };
    expect(output.runDirectory).toBeDefined();
    const kept = join(directory, output.runDirectory ?? "");
    const logs = await Promise.all(
      ["engine.log", "sg.log", "runtime.log"].map((name) =>
        readFile(join(kept, name), "utf8")
      )
    );
    expect(logs[0]).toContain("reconcile answered");
    expect(logs[0]).toContain("runtime/demo: run, runs");
    expect(logs[2]).toMatch(/demo: \d+ finding\(s\) in \d+ms/);
    for (const log of logs) expect(log).not.toContain("fake.token");
  });
});
