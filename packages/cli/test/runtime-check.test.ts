import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateFixture } from "./support/current-project";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

interface ReportedFile {
  file: string;
  signature: string;
}
interface ReconcileRequestBody {
  repositoryUrl: string;
  files: ReportedFile[];
}
type Responder = (request: ReconcileRequestBody) => {
  statusCode: number;
  body?: unknown;
};
interface MockServer {
  apiUrl: string;
  requests: ReconcileRequestBody[];
  headers: Record<string, string | string[] | undefined>[];
  close: () => Promise<void>;
}

/** Start a mock reconcile endpoint on a random port. */
function startMockServer(responder: Responder): Promise<MockServer> {
  const requests: ReconcileRequestBody[] = [];
  const headers: Record<string, string | string[] | undefined>[] = [];
  const server: Server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/cli/api/reconcile") {
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
        headers,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/** Echo a reported file's signature back so the mock can bless it. */
function sig(request: ReconcileRequestBody, endsWith: string): string {
  return request.files.find((f) => f.file.endsWith(endsWith))?.signature ?? "";
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
function parseJson(stdout: string): {
  success: boolean;
  results: { source: string; ruleId: string }[];
  skipped?: { rule: string; reason: string }[];
} {
  const line = stdout
    .trim()
    .split("\n")
    .findLast((l) => l.trim().startsWith("{"));
  return JSON.parse(line ?? "{}") as {
    success: boolean;
    results: { source: string; ruleId: string }[];
    skipped?: { rule: string; reason: string }[];
  };
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

const CHECK_REPORT_PATH = ".taskless/runtime/rules/demo/check.ts";

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

  it("authed + blessed check.ts: runtime runs; only check.ts is reported", async () => {
    const server = await startMockServer((request) => ({
      statusCode: 200,
      body: {
        run: [
          {
            ruleId: "demo",
            file: CHECK_REPORT_PATH,
            signature: sig(request, "check.ts"),
          },
        ],
        unsafe: [],
        unknown: [],
        missing: [],
      },
    }));
    try {
      const { stdout } = await runCli(["check", "-d", directory, "--json"], {
        TASKLESS_TOKEN: "fake.token",
        TASKLESS_API_URL: server.apiUrl,
      });
      // Only the runtime check.ts is reported — never the static rule.
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]!.files).toHaveLength(1);
      expect(server.requests[0]!.files[0]!.file.endsWith("check.ts")).toBe(
        true
      );
      const output = parseJson(stdout);
      expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
        true
      );
      expect(output.results.some((r) => r.ruleId === "no-console")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("authed + empty run set: runtime withheld, static still runs", async () => {
    const server = await startMockServer(() => ({
      statusCode: 200,
      body: { run: [], unsafe: [], unknown: [], missing: [] },
    }));
    try {
      const { stdout } = await runCli(["check", "-d", directory, "--json"], {
        TASKLESS_TOKEN: "fake.token",
        TASKLESS_API_URL: server.apiUrl,
      });
      const output = parseJson(stdout);
      expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
        false
      );
      expect(output.results.some((r) => r.ruleId === "no-console")).toBe(true);
      expect(output.skipped?.some((s) => s.rule === "demo")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("reconcile unavailable: runtime skipped, static runs, exit 0", async () => {
    const server = await startMockServer(() => ({ statusCode: 503 }));
    try {
      const { stdout, exitCode } = await runCli(
        ["check", "-d", directory, "--json"],
        { TASKLESS_TOKEN: "fake.token", TASKLESS_API_URL: server.apiUrl }
      );
      const output = parseJson(stdout);
      expect(exitCode).toBe(0);
      expect(output.results.some((r) => r.ruleId === "no-console")).toBe(true);
      expect(output.skipped?.some((s) => s.rule === "demo")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("--anonymous with a token: skips runtime and never calls reconcile", async () => {
    const server = await startMockServer(() => ({
      statusCode: 200,
      body: { run: [], unsafe: [], unknown: [], missing: [] },
    }));
    try {
      const { stdout } = await runCli(
        ["check", "-d", directory, "--json", "--anonymous"],
        { TASKLESS_TOKEN: "fake.token", TASKLESS_API_URL: server.apiUrl }
      );
      expect(server.requests).toHaveLength(0);
      const output = parseJson(stdout);
      expect(output.skipped?.some((s) => s.rule === "demo")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("--dangerously-run-scripts: runs runtime offline behind a warning", async () => {
    const { stdout, stderr } = await runCli([
      "check",
      "-d",
      directory,
      "--dangerously-run-scripts",
    ]);
    expect(stderr).toContain("dangerously-run-scripts");
    expect(stdout).toContain("demo"); // runtime finding surfaced
  });

  it("a runtime rule missing check.ts is skipped, not fatal; static still runs", async () => {
    // A malformed rule (capture yml, no check.ts) must not abort the whole check.
    const broken = join(directory, ".taskless", "runtime", "rules", "broken");
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, "logs.yml"), RUNTIME_CAPTURE, "utf8");

    const server = await startMockServer((request) => ({
      statusCode: 200,
      body: {
        run: [
          {
            ruleId: "demo",
            file: CHECK_REPORT_PATH,
            signature: sig(request, "check.ts"),
          },
        ],
        unsafe: [],
        unknown: [],
        missing: [],
      },
    }));
    try {
      const { stdout, exitCode } = await runCli(
        ["check", "-d", directory, "--json"],
        {
          TASKLESS_TOKEN: "fake.token",
          TASKLESS_API_URL: server.apiUrl,
        }
      );
      const output = parseJson(stdout);
      expect(exitCode).toBe(0); // not SCAN_FAILED
      // The good runtime rule still ran and static still ran.
      expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
        true
      );
      expect(output.results.some((r) => r.ruleId === "no-console")).toBe(true);
      // The broken rule is reported as skipped, not crashed.
      expect(output.skipped?.some((s) => s.rule === "broken")).toBe(true);
      // Only the readable check.ts was reported to the server.
      expect(server.requests[0]!.files).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("declares the CLI version via the x-taskless-cli-version header", async () => {
    const server = await startMockServer(() => ({
      statusCode: 200,
      body: { run: [], unsafe: [], unknown: [], missing: [] },
    }));
    try {
      await runCli(["check", "-d", directory, "--json"], {
        TASKLESS_TOKEN: "fake.token",
        TASKLESS_API_URL: server.apiUrl,
      });
      expect(server.requests).toHaveLength(1);
      const version = server.headers[0]?.["x-taskless-cli-version"];
      expect(typeof version).toBe("string");
      expect(version).not.toBe("");
      expect(version).not.toBe("unknown");
    } finally {
      await server.close();
    }
  });
});
