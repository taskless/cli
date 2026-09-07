import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { restoreRule } from "../src/api/restore";
import { canonicalHash } from "../src/rules/rule-hash";
import { migrateFixture } from "./support/current-project";

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

/**
 * A reconcile handler normally returns the response body directly (always
 * HTTP 200). A handler that instead needs to exercise a non-2xx reconcile
 * response (e.g. the unauthorized branch of `planRuntime`) returns this
 * wrapper, distinguished by its `statusCode` field — no ordinary reconcile
 * response body (`{ run, unsafe, unknown, missing }`) has one.
 */
interface HttpOverride {
  statusCode: number;
  body: unknown;
}

function isHttpOverride(value: unknown): value is HttpOverride {
  return (
    typeof value === "object" &&
    value !== null &&
    "statusCode" in value &&
    typeof (value as { statusCode: unknown }).statusCode === "number" &&
    "body" in value
  );
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
        const result = handlers.reconcile(
          JSON.parse(raw) as { files: { file: string; signature: string }[] }
        );
        const { statusCode, body } = isHttpOverride(result)
          ? result
          : { statusCode: 200, body: result };
        response.writeHead(statusCode, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
        return;
      }
      const restore = /^\/cli\/api\/request\/([^/]+)\/restore$/.exec(url);
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
  // The fixture writes a current-layout tree but no manifest, and `check`
  // refuses a project it cannot confirm is current — a tree without a
  // manifest reads as version 0, and it cannot tell this one from a
  // pre-`0004` project by looking. So the scaffold is completed here, which
  // is what a real project has.
  await migrateFixture(args);
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

/**
 * Reconcile reporting the reported check as drifted from `expected`.
 *
 * `ruleId` is what restore is keyed on. It defaults to the rule directory's
 * name only so the ordinary fixtures read naturally; nothing derives it from
 * `REPORTED`, and the disagreeing-id test below passes one that does not match
 * the path at all.
 */
const driftedReconcile =
  (expected: string, ruleId = "demo") =>
  () => ({
    run: [],
    unsafe: [{ ruleId, file: REPORTED, expected, got: "1;h=sha-256;d=stale" }],
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

  it("leaves the rule directory holding exactly the blessed set, minus fixtures", async () => {
    // #233. Repair runs BECAUSE the directory's trustworthiness is in
    // question, and only `check.ts` is signed — so a stray capture beside the
    // rule is never reported by reconcile, was never replaced by the repair,
    // and went on changing what the rule matched while the rule read as
    // repaired. The delivered set is now the directory.
    const rule = join(directory, ".taskless", "rules", "runtime", "demo");
    await writeFile(
      join(rule, "captures", "stray.yml"),
      CAPTURE.replace("logs-abc12345", "stray-abc12345"),
      "utf8"
    );
    // A fixture no delivered set will ever name: this CLI writes timestamped
    // ones itself. Kept, and the notice says so rather than leaving a reader
    // to infer it.
    await mkdir(join(rule, ".tests"), { recursive: true });
    await writeFile(join(rule, ".tests", "demo-1970-test.yml"), "id: demo\n");

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

      expect(existsSync(join(rule, "captures", "stray.yml"))).toBe(false);
      expect(existsSync(join(rule, ".tests", "demo-1970-test.yml"))).toBe(true);
      // The rule is whole afterwards. A repair that leaves it inert would be
      // the bug, not a trade-off.
      await expect(readFile(checkFile, "utf8")).resolves.toBe(BLESSED);
      expect(existsSync(join(rule, "captures", "logs.yml"))).toBe(true);

      const notices = (envelope(stdout).notices ?? []).join("\n");
      expect(notices).toMatch(/was restored/);
      expect(notices).toContain(".tests/");
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

  it("asks for the id the unsafe entry carries, not the one in its path", async () => {
    // #240. The entry names `logs-abc12345` while its path's rule directory is
    // `demo`, and the entry wins. This is the assertion a path-parsing
    // implementation fails: it would ask for `demo`, and after a layout move it
    // would ask for something the service never issued, take a 404, and leave
    // the rule unrepaired and unexecuted with nothing said on any channel.
    const blessed = await canonicalHash(BLESSED);
    const mock = await startMock({
      reconcile: driftedReconcile(blessed, "logs-abc12345"),
      restore: (ruleId) => ({
        statusCode: 200,
        body: {
          ruleId,
          rules: [
            {
              id: ruleId,
              engine: "runtime",
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
      await runCli(["check", "-d", directory, "--json"], {
        TASKLESS_TOKEN: "fake.token",
        TASKLESS_API_URL: mock.apiUrl,
      });
      expect(mock.restoreCalls).toEqual(["logs-abc12345"]);
      // And the repair completed, so the entry's id was what reached restore
      // rather than the request merely landing somewhere harmless. The bytes
      // land under the id's own directory, since the delivered set decides
      // where a rule lives and the reported path never did.
      await expect(
        readFile(
          join(directory, ".taskless/rules/runtime/logs-abc12345/check.ts"),
          "utf8"
        )
      ).resolves.toBe(BLESSED);
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

  it("asks for nothing when an unsafe entry carries no rule id, and says why", async () => {
    // The deployed schema requires `ruleId` on `unsafe`, and `reconcile`
    // decodes with a cast rather than a schema — so a rollback, a canary, or a
    // regression can put an entry like this on the wire despite the `string`
    // type. Without a guard `restoreRule` interpolates `undefined` and the CLI
    // requests `/cli/api/request/undefined/restore`: a call that cannot
    // succeed, made for a rule nobody named.
    const mock = await startMock({
      reconcile: () => ({
        run: [],
        unsafe: [
          {
            file: REPORTED,
            expected: "1;h=sha-256;d=a",
            got: "1;h=sha-256;d=b",
          },
        ],
        unknown: [],
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

      // The whole point: no request at all, and in particular not the literal
      // `undefined` the unguarded path would have sent.
      expect(mock.restoreCalls).toEqual([]);
      // Not a silent skip. `--json` is what CI reads, so the notice has to be
      // here and it has to name the file.
      expect(notices).toContain(REPORTED);
      expect(notices).toMatch(/did not say which rule it belongs to/);
      // Withheld, not repaired: the drifted bytes are untouched, which is
      // already the safe state for a rule that could not be verified.
      await expect(readFile(checkFile, "utf8")).resolves.toBe(DRIFTED);
    } finally {
      await mock.close();
    }
  });

  it("says '1 stale entry ... it' when the repair leaves exactly one behind", async () => {
    // plan.ts's `repairWithheldRules` wraps `PurgeIncompleteError` in its own
    // wording rather than reusing the error's message, and pluralizes it by
    // hand — a seam `deliver.test.ts` cannot see, since it only ever throws
    // the error, never renders this notice.
    const rule = join(directory, ".taskless", "rules", "runtime", "demo");
    await mkdir(join(rule, "blocked"), { recursive: true });
    await writeFile(join(rule, "blocked", "a.txt"), "stuck\n", "utf8");
    await chmod(join(rule, "blocked"), 0o500);

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
      const notices = (envelope(stdout).notices ?? []).join("\n");
      expect(notices).toMatch(
        /was rewritten with the bytes the service blessed, but 1 stale entry could not be removed and an engine still reads it/
      );
      expect(notices).toContain("blocked/a.txt");
      // The bytes still landed — a failed cleanup is not a failed write.
      await expect(readFile(checkFile, "utf8")).resolves.toBe(BLESSED);
    } finally {
      await chmod(join(rule, "blocked"), 0o700);
      await mock.close();
    }
  });

  it("says '<n> stale entries ... them' when the repair leaves several behind", async () => {
    const rule = join(directory, ".taskless", "rules", "runtime", "demo");
    await mkdir(join(rule, "blocked-one"), { recursive: true });
    await writeFile(join(rule, "blocked-one", "a.txt"), "stuck\n", "utf8");
    await chmod(join(rule, "blocked-one"), 0o500);
    await mkdir(join(rule, "blocked-two"), { recursive: true });
    await writeFile(join(rule, "blocked-two", "b.txt"), "stuck\n", "utf8");
    await chmod(join(rule, "blocked-two"), 0o500);

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
      const notices = (envelope(stdout).notices ?? []).join("\n");
      expect(notices).toMatch(
        /was rewritten with the bytes the service blessed, but 2 stale entries could not be removed and an engine still reads them/
      );
      expect(notices).toContain("blocked-one/a.txt");
      expect(notices).toContain("blocked-two/b.txt");
      await expect(readFile(checkFile, "utf8")).resolves.toBe(BLESSED);
    } finally {
      await chmod(join(rule, "blocked-one"), 0o700);
      await chmod(join(rule, "blocked-two"), 0o700);
      await mock.close();
    }
  });

  it("skips every runtime rule when reconcile's own authentication is rejected", async () => {
    // `planRuntime`'s `unauthorized` branch (plan.ts) — distinct from
    // restore's `unauthorized`, and reachable only when the reconcile call
    // itself, not the later restore call, gets a 401.
    const mock = await startMock({
      reconcile: () => ({ statusCode: 401, body: {} }),
      restore: () => ({ statusCode: 500, body: {} }),
    });
    try {
      const { stdout } = await runCli(["check", "-d", directory, "--json"], {
        TASKLESS_TOKEN: "fake.token",
        TASKLESS_API_URL: mock.apiUrl,
      });
      const output = envelope(stdout) as {
        skipped?: { rule: string; reason: string }[];
      };
      expect(output.skipped).toHaveLength(1);
      expect(output.skipped?.[0]?.rule).toBe("demo");
      expect(output.skipped?.[0]?.reason).toContain(
        "authentication was rejected"
      );
      // Rejected before any restore could even be considered.
      expect(mock.restoreCalls).toEqual([]);
      await expect(readFile(checkFile, "utf8")).resolves.toBe(DRIFTED);
    } finally {
      await mock.close();
    }
  });

  it("skips every runtime rule when materialization fails, without failing the run", async () => {
    // plan.ts's materialize-failure catch. Blessing whatever `check.ts` was
    // actually reported sidesteps needing to know `signRuleFile`'s exact
    // envelope format — the point of this test is the catch, not the sign.
    //
    // `.taskless/.gitignore` is replaced with a directory so `addToGitignore`'s
    // `writeFile` (called from `materializeRuntimeRules`) fails with EISDIR.
    // The scaffold migration (`migrateFixture`, inside `runCli`) writes that
    // file itself as part of bringing the fixture current, so the block has to
    // go on AFTER migration — doing it first makes the migration itself throw,
    // before `check` ever runs.
    await migrateFixture(["check", "-d", directory]);
    await rm(join(directory, ".taskless", ".gitignore"), { force: true });
    await mkdir(join(directory, ".taskless", ".gitignore"));

    const mock = await startMock({
      reconcile: (body) => ({
        run: body.files.map((file) => ({
          ruleId: "demo",
          file: file.file,
          signature: file.signature,
        })),
        unsafe: [],
        unknown: [],
        missing: [],
      }),
      restore: () => ({ statusCode: 500, body: {} }),
    });
    try {
      let stdout: string;
      let exitCode: number;
      try {
        ({ stdout } = await execFileAsync(
          "node",
          [binPath, "check", "-d", directory, "--json"],
          {
            env: {
              ...process.env,
              TASKLESS_TOKEN: "fake.token",
              TASKLESS_API_URL: mock.apiUrl,
            },
          }
        ));
        exitCode = 0;
      } catch (error) {
        const failure = error as { stdout: string; code: number };
        stdout = failure.stdout ?? "";
        exitCode = failure.code;
      }
      // A materialize failure is a notice, never a failed run.
      expect(exitCode).toBe(0);
      const output = envelope(stdout) as {
        skipped?: { rule: string; reason: string }[];
      };
      expect(output.skipped).toHaveLength(1);
      expect(output.skipped?.[0]?.rule).toBe("demo");
      expect(output.skipped?.[0]?.reason).toContain(
        "runtime rules could not be materialized"
      );
      expect(mock.restoreCalls).toEqual([]);
    } finally {
      await mock.close();
    }
  });
});

describe("restoreRule's HTTP contract", () => {
  let server: Server;
  let originalApiUrl: string | undefined;
  let respond: (response: import("node:http").ServerResponse) => void;

  beforeEach(async () => {
    originalApiUrl = process.env.TASKLESS_API_URL;
    server = createServer((request, response) => {
      request.resume();
      request.on("end", () => respond(response));
    });
    await new Promise<void>((done) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        process.env.TASKLESS_API_URL = `http://127.0.0.1:${String(port)}/cli`;
        done();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    if (originalApiUrl === undefined) {
      delete process.env.TASKLESS_API_URL;
    } else {
      process.env.TASKLESS_API_URL = originalApiUrl;
    }
  });

  const request = {
    ruleId: "demo",
    repositoryUrl: "https://github.com/acme/widgets.git",
  };

  it("maps HTTP 401 to `unauthorized`", async () => {
    respond = (response) => {
      response.writeHead(401, { "content-type": "application/json" });
      response.end("{}");
    };
    await expect(restoreRule("token", request)).resolves.toEqual({
      status: "unauthorized",
    });
  });

  it("maps a non-ok status to `unavailable`", async () => {
    respond = (response) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end("{}");
    };
    await expect(restoreRule("token", request)).resolves.toEqual({
      status: "unavailable",
      reason: "HTTP 500",
    });
  });

  it("maps a body `response.json()` cannot parse to `unavailable`", async () => {
    respond = (response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("not json");
    };
    await expect(restoreRule("token", request)).resolves.toEqual({
      status: "unavailable",
      reason: "invalid response body",
    });
  });

  it("maps a body without an array `rules` to `unavailable`", async () => {
    respond = (response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ruleId: "demo" }));
    };
    await expect(restoreRule("token", request)).resolves.toEqual({
      status: "unavailable",
      reason: "response carried no `rules`",
    });
  });

  it("maps a fetch that throws to `unavailable`", async () => {
    // No handler is registered on the running mock server for this one — the
    // request is pointed at a closed local port instead, so `fetch` itself
    // rejects (ECONNREFUSED) rather than the server answering.
    process.env.TASKLESS_API_URL = "http://127.0.0.1:1/cli";
    const outcome = await restoreRule("token", request);
    expect(outcome.status).toBe("unavailable");
    expect(
      (outcome as { status: "unavailable"; reason: string }).reason
    ).toMatch(/network error/);
  });
});
