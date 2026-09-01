import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalHash } from "../src/rules/rule-hash";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

/**
 * The repair path end to end: reconcile reports drift, restore answers, the
 * file is rewritten, and the run says so.
 *
 * `repair.test.ts` covers the decisions as pure functions. What it cannot see
 * is the wiring, and the wiring is where this feature failed review: every
 * repair notice reached `warn()` only, which is a no-op under `--json`, so the
 * one channel a CI run reads dropped the entire output of the thing whose
 * purpose is explaining a rule that did not run. A test at this level is what
 * would have caught it, so it is the first assertion below.
 */

/** A mock serving both endpoints the repair path uses. */
interface Mock {
  apiUrl: string;
  restoreCalls: string[];
  close: () => Promise<void>;
}

function startMock(handlers: {
  reconcile: (body: {
    files: { file: string; signature: string }[];
  }) => unknown;
  restore: (ruleId: string) => { statusCode: number; body: unknown };
}): Promise<Mock> {
  const restoreCalls: string[] = [];
  const server: Server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    request.on("end", () => {
      const url = request.url ?? "";
      if (url === "/cli/api/reconcile") {
        const body = handlers.reconcile(
          JSON.parse(raw) as { files: { file: string; signature: string }[] }
        );
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
        return;
      }
      const restore = /^\/cli\/api\/rule\/([^/]+)\/restore$/.exec(url);
      if (restore) {
        const ruleId = decodeURIComponent(restore[1] ?? "");
        restoreCalls.push(ruleId);
        const { statusCode, body } = handlers.restore(ruleId);
        response.writeHead(statusCode, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
        return;
      }
      response.writeHead(404).end("{}");
    });
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({
        apiUrl: `http://127.0.0.1:${String(port)}/cli`,
        restoreCalls,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function runCli(
  args: string[],
  env: Record<string, string>
): Promise<{ stdout: string; exitCode: number }> {
  try {
    const { stdout } = await execFileAsync("node", [binPath, ...args], {
      env: { ...process.env, ...env },
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout: string; code: number };
    return { stdout: failure.stdout ?? "", exitCode: failure.code };
  }
}

/** The `--json` envelope, ignoring any migration chatter before it. */
function envelope(stdout: string): { notices?: string[] } {
  const line = stdout
    .trim()
    .split("\n")
    .findLast((l) => l.trim().startsWith("{"));
  return JSON.parse(line ?? "{}") as { notices?: string[] };
}

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

const DRIFTED = "export default async () => [];\n";
const BLESSED = "export default async function () {\n  return [];\n}\n";
const REPORTED = ".taskless/rules/runtime/demo/check.ts";

/** Reconcile reporting the reported check as drifted from `expected`. */
const driftedReconcile = (expected: string) => () => ({
  run: [],
  unsafe: [{ file: REPORTED, expected, got: "1;h=sha-256;d=stale" }],
  unknown: [],
  missing: [],
});

describe("repairing a drifted runtime rule, end to end", () => {
  let directory: string;
  let checkFile: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tskl-repair-"));
    const rule = join(directory, ".taskless", "rules", "runtime", "demo");
    await mkdir(join(rule, "captures"), { recursive: true });
    await writeFile(join(rule, "captures", "logs.yml"), CAPTURE, "utf8");
    checkFile = join(rule, "check.ts");
    await writeFile(checkFile, DRIFTED, "utf8");
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

  it("reports the repair on the --json envelope, not only on stderr", async () => {
    // The regression this test exists for. `--json` is what CI reads, and the
    // repair notices used to reach `warn()` alone.
    const blessed = await canonicalHash(BLESSED);
    const mock = await startMock({
      reconcile: driftedReconcile(blessed),
      restore: () => ({
        statusCode: 200,
        body: {
          ruleId: "demo",
          rules: [
            {
              id: "demo",
              engine: "runtime",
              // The COMPLETE set. The schema calls `files` "every file the
              // rule directory must contain", and `writeRuleFile` enforces
              // that: a runtime rule restored without its captures would be
              // written, verify as incomplete, and never fire.
              files: [
                { path: "check.ts", content: BLESSED },
                { path: "captures/logs.yml", content: CAPTURE },
              ],
              signature: blessed,
            },
          ],
        },
      }),
    });
    try {
      const { stdout } = await runCli(["check", "-d", directory, "--json"], {
        TASKLESS_TOKEN: "fake.token",
        TASKLESS_API_URL: mock.apiUrl,
      });

      const notices = envelope(stdout).notices ?? [];
      expect(notices.join("\n")).toContain(REPORTED);
      expect(notices.join("\n")).toMatch(/blessed/);
      expect(mock.restoreCalls).toEqual(["demo"]);

      // And the bytes actually landed.
      await expect(readFile(checkFile, "utf8")).resolves.toBe(BLESSED);
    } finally {
      await mock.close();
    }
  });

  it("refuses bytes that are not the ones reconcile blessed, and says so", async () => {
    // The service answers consistently — it signs exactly what it sends — and
    // sends a NEWER rule than the one we were owed. Nothing is written.
    const owed = await canonicalHash(BLESSED);
    const newer = "export default async () => [{ file: 'x' }];\n";
    const newerSignature = await canonicalHash(newer);
    const mock = await startMock({
      reconcile: driftedReconcile(owed),
      restore: () => ({
        statusCode: 200,
        body: {
          ruleId: "demo",
          rules: [
            {
              id: "demo",
              engine: "runtime",
              files: [
                { path: "check.ts", content: newer },
                { path: "captures/logs.yml", content: CAPTURE },
              ],
              signature: newerSignature,
            },
          ],
        },
      }),
    });
    try {
      const { stdout } = await runCli(["check", "-d", directory, "--json"], {
        TASKLESS_TOKEN: "fake.token",
        TASKLESS_API_URL: mock.apiUrl,
      });
      const notices = (envelope(stdout).notices ?? []).join("\n");
      expect(notices).toMatch(/was not restored/);
      expect(notices).toMatch(/does not upgrade/);
      await expect(readFile(checkFile, "utf8")).resolves.toBe(DRIFTED);
    } finally {
      await mock.close();
    }
  });

  it("explains a rule the service will not return", async () => {
    const mock = await startMock({
      reconcile: driftedReconcile(await canonicalHash(BLESSED)),
      restore: () => ({ statusCode: 404, body: {} }),
    });
    try {
      const { stdout } = await runCli(["check", "-d", directory, "--json"], {
        TASKLESS_TOKEN: "fake.token",
        TASKLESS_API_URL: mock.apiUrl,
      });
      const notices = (envelope(stdout).notices ?? []).join("\n");
      expect(notices).toMatch(/could not be restored/);
      // A repair that cannot happen is a notice, never a failed run: the rule
      // stays withheld, which is already the safe state.
      await expect(readFile(checkFile, "utf8")).resolves.toBe(DRIFTED);
    } finally {
      await mock.close();
    }
  });

  it("says why an unknown file cannot be restored, and asks for nothing", async () => {
    const mock = await startMock({
      reconcile: () => ({
        run: [],
        unsafe: [],
        unknown: [{ file: REPORTED }],
        missing: [],
      }),
      restore: () => ({ statusCode: 500, body: {} }),
    });
    try {
      const { stdout } = await runCli(["check", "-d", directory, "--json"], {
        TASKLESS_TOKEN: "fake.token",
        TASKLESS_API_URL: mock.apiUrl,
      });
      const notices = (envelope(stdout).notices ?? []).join("\n");
      expect(notices).toMatch(/was not issued by the rule service/);
      // Nothing on the server to ask for, so nothing is asked.
      expect(mock.restoreCalls).toEqual([]);
    } finally {
      await mock.close();
    }
  });
});
