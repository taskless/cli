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
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateFixture } from "./support/current-project";
import { builtCli } from "./support/built-cli";

const execFileAsync = promisify(execFile);
const binPath = builtCli();

interface ReportedRule {
  ruleId: string;
  files: { path: string; signature: string }[];
}
interface ReconcileRequestBody {
  repositoryUrl: string;
  orgId?: string | number;
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

/**
 * Start a mock v2 reconcile endpoint on a random port. `whoami`, when given,
 * is served as `GET /cli/api/v2/whoami`; otherwise that route is a 404, which
 * the CLI reads as an unknown organization.
 */
function startMockServer(
  responder: Responder,
  whoami?: unknown
): Promise<MockServer> {
  const requests: ReconcileRequestBody[] = [];
  const paths: string[] = [];
  const headers: Record<string, string | string[] | undefined>[] = [];
  const server: Server = createServer((request, response) => {
    paths.push(`${request.method ?? ""} ${request.url ?? ""}`);
    if (
      whoami !== undefined &&
      request.method === "GET" &&
      request.url === "/cli/api/v2/whoami"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(whoami));
      return;
    }
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
  | { unsafe: { path: string; expected?: string; got?: string }[] }
  | { copyOf: { ruleId: string; revisionId: string; files: unknown[] } };

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
  const unknown: { ruleId: string; copyOf?: unknown }[] = [];
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
        if ("copyOf" in verdict) {
          unknown.push({ ruleId, copyOf: verdict.copyOf });
          break;
        }
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
    copyOf?: unknown;
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

  it("logged out: one notice says rules were not verified and names auth login", async () => {
    const { stderr } = await runCli(["check", "-d", directory]);
    expect(stderr.split("Rules were not verified")).toHaveLength(2);
    expect(stderr).toContain(
      "Notice: Rules were not verified: not authenticated."
    );
    expect(stderr).toContain("1 runtime rule(s) did not run");
    expect(stderr).toMatch(
      /did not run\. Run `.+ auth login`, or set `TASKLESS_TOKEN`/
    );
  });

  it("logged out with no runtime rules: the notice still prints, and is in --json notices", async () => {
    await rm(join(directory, ".taskless", "runtime"), {
      recursive: true,
      force: true,
    });
    const human = await runCli(["check", "-d", directory]);
    expect(human.stderr).toContain(
      "Notice: Rules were not verified: not authenticated. Static rules ran without verification."
    );
    expect(human.stderr).not.toContain("runtime rule");
    expect(human.stderr).toContain("auth login");

    const { stdout, exitCode } = await runCli([
      "check",
      "-d",
      directory,
      "--json",
    ]);
    const output = parseJson(stdout);
    expect(exitCode).toBe(0);
    expect(output.skipped).toBeUndefined();
    expect(output.notices?.join("\n")).toMatch(
      /Rules were not verified: not authenticated/
    );
  });

  it("--anonymous: the notice names dropping --anonymous, not auth login", async () => {
    const { stderr } = await runCli(["check", "-d", directory, "--anonymous"]);
    expect(stderr).toContain("Rules were not verified: `--anonymous` was set.");
    expect(stderr).toContain("without `--anonymous`");
    expect(stderr).not.toContain("auth login");
  });

  it.each([
    {
      name: "no origin remote",
      arrange: (cwd: string) =>
        execFileAsync("git", ["remote", "remove", "origin"], { cwd }),
      cause: "this repository has no `origin` remote",
      remedy: "git remote add origin",
    },
    {
      name: "a non-GitHub origin",
      arrange: (cwd: string) =>
        execFileAsync(
          "git",
          [
            "remote",
            "set-url",
            "origin",
            "https://gitlab.com/acme/widgets.git",
          ],
          { cwd }
        ),
      cause: "`origin` is not a GitHub remote (gitlab.com/acme/widgets)",
      remedy: "supports GitHub repositories only",
    },
    {
      name: "not a git repository",
      arrange: (cwd: string) =>
        rm(join(cwd, ".git"), { recursive: true, force: true }),
      cause: "this directory is not a git repository",
      remedy: "so run `check` in a clone of the repository",
    },
  ])(
    "authenticated with $name: the notice names that remote problem",
    async ({ arrange, cause, remedy }) => {
      await arrange(directory);
      const { stderr, exitCode } = await runCli(["check", "-d", directory], {
        TASKLESS_TOKEN: "fake.token",
        // Never reached: the remote is resolved before any network call.
        TASKLESS_API_URL: "http://127.0.0.1:9/cli",
      });
      expect(exitCode).toBe(0);
      expect(stderr).toContain(`Rules were not verified: ${cause}.`);
      expect(stderr).toContain(remedy);
    }
  );

  /** Run \`check\` authenticated against a mock that answers with \`responder\`. */
  async function authedCheck(
    responder: Responder,
    extraArguments: string[] = ["--json"],
    whoami?: unknown
  ) {
    const server = await startMockServer(responder, whoami);
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

  it("on a plan without rule recovery, an edited or missing rule gets git steps, not rule restore", async () => {
    const whoami = {
      user: "Ada",
      orgs: [
        {
          id: "uuid-acme",
          name: "acme",
          source: "github",
          url: "https://github.com/acme",
          entitlements: {
            remoteGeneration: true,
            runtimeSignatures: true,
            restoreRules: false,
          },
        },
      ],
    };
    const { stdout, server } = await authedCheck(
      (request) => ({
        statusCode: 200,
        body: answer(
          request,
          {
            "no-console": "run",
            demo: {
              unsafe: [{ path: "captures/extra.yml", got: "1;h=sha-256;d=22" }],
            },
          },
          {
            missing: [
              { ruleId: "gone-3fa9c21b", engine: "vale", revisionId: "rev-9" },
            ],
          }
        ),
      }),
      ["--json"],
      whoami
    );
    const notices = parseJson(stdout).notices?.join("\n") ?? "";
    // The acting org came from the same whoami call that carried the plan.
    expect(server.requests[0]?.orgId).toBe("uuid-acme");
    expect(notices).toContain("git log -- .taskless/rules/runtime/demo/");
    expect(notices).toContain("git log -- .taskless/rules/vale/gone-3fa9c21b/");
    expect(notices).not.toContain("rule restore");
  });

  it("a renamed copy of an issued rule does not run, fails once as a rename, and logs it", async () => {
    await migrateFixture(["-d", directory]);
    const before = await treeDigest(directory);
    const copyOf = {
      ruleId: "no-console-3fa9c21b",
      revisionId: "rev-4",
      files: [
        {
          path: "no-console.yml",
          expected: "1;h=sha-256;d=00",
          got: "1;h=sha-256;d=11",
        },
      ],
    };
    const { stdout, exitCode } = await authedCheck(
      (request) => ({
        statusCode: 200,
        body: answer(
          request,
          { demo: "run", "no-console": { copyOf } },
          {
            missing: [
              {
                ruleId: "no-console-3fa9c21b",
                engine: "sg",
                revisionId: "rev-5",
              },
            ],
          }
        ),
      }),
      ["--json", "--preserve-logs"]
    );
    const output = parseJson(stdout) as CheckJson & { runDirectory?: string };
    expect(exitCode).toBe(1);
    expect(output.success).toBe(false);
    // Removed from the snapshot: the copy found nothing, the runtime rule ran.
    expect(output.results.some((r) => r.ruleId === "no-console")).toBe(false);
    expect(output.results.some((r) => r.source === "taskless-runtime")).toBe(
      true
    );
    expect(output.failures).toHaveLength(1);
    expect(output.failures?.[0]).toMatch(
      /sg rule no-console is a copy of Taskless rule no-console-3fa9c21b, which was deleted \(changed no-console\.yml\).*rule restore no-console-3fa9c21b/
    );
    // One finding: the source's own missing warning is folded into the rename.
    expect(output.notices ?? []).toEqual([]);
    expect(output.integrity).toEqual([
      {
        ruleId: "no-console",
        engine: "sg",
        verdict: "unknown",
        files: copyOf.files,
        copyOf: {
          ruleId: "no-console-3fa9c21b",
          revisionId: "rev-4",
          sourceMissing: true,
        },
      },
      {
        ruleId: "no-console-3fa9c21b",
        engine: "sg",
        verdict: "missing",
        revisionId: "rev-5",
      },
    ]);
    const engineLog = await readFile(
      join(directory, output.runDirectory ?? "", "engine.log"),
      "utf8"
    );
    expect(engineLog).toContain(
      "copy: no-console carries files of no-console-3fa9c21b (revision rev-4), which is missing: a rename"
    );
    expect(engineLog).toMatch(/sg\/no-console: unknown, excluded \(a copy of/);
    expect(await treeDigest(directory)).toBe(before);
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
    // Not "Rename one.": renaming the issued side makes it a copy, which does
    // not run either, and a rename has to reach every place the id appears.
    const failure = output.failures?.join("\n") ?? "";
    expect(failure).toContain(
      "Rename the rule you wrote locally, not the one Taskless issued"
    );
    expect(failure).toContain(
      "under sg, the directory, demo.yml and its `id:`, and each .tests/demo-*-test.yml and its `id:`; under runtime, the directory alone."
    );
  });

  it("reconcile unavailable: runtime skipped, static runs, exit 0, and it says so", async () => {
    const { stdout, exitCode } = await authedCheck(() => ({ statusCode: 503 }));
    const output = parseJson(stdout);
    expect(exitCode).toBe(0);
    expect(output.results.some((r) => r.ruleId === "no-console")).toBe(true);
    expect(output.skipped?.some((s) => s.rule === "demo")).toBe(true);
    expect(output.notices?.join("\n")).toMatch(
      /Rules were not verified: the rule service was unavailable/
    );
    expect(output.notices?.join("\n")).toMatch(/try again/);
  });

  it("organization not found: the notice names the app installation and auth login", async () => {
    const { stderr, exitCode } = await authedCheck(
      () => ({ statusCode: 404, body: { error: "organization_not_found" } }),
      []
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain(
      "Rules were not verified: the Taskless GitHub App installation does not cover this repository"
    );
    expect(stderr).toContain(
      "Confirm the Taskless app is installed on this repository's owner"
    );
    expect(stderr).toMatch(
      /If access recently changed, re-authenticate with `.+ auth logout` then `.+ auth login`/
    );
  });

  it("reconcile validation_error: reported as a rejection, never as an outage", async () => {
    const { stdout, exitCode } = await authedCheck(() => ({
      statusCode: 400,
      body: { error: "validation_error", details: ["rules: too many"] },
    }));
    const output = parseJson(stdout);
    expect(exitCode).toBe(0);
    const notices = output.notices?.join("\n") ?? "";
    expect(notices).toMatch(/rejected the verification request/);
    expect(notices).toContain("rules: too many");
    expect(notices).not.toMatch(/unavailable|try again/);
  });

  // authedCheck supplies the token through TASKLESS_TOKEN, which `auth login`
  // cannot replace, so the remedy names the variable rather than the command.
  it("token rejected: the notice names replacing TASKLESS_TOKEN", async () => {
    const { stderr, exitCode } = await authedCheck(
      () => ({ statusCode: 401 }),
      []
    );
    expect(exitCode).toBe(0);
    expect(stderr.split("Rules were not verified")).toHaveLength(2);
    expect(stderr).toContain(
      "Rules were not verified: authentication was rejected."
    );
    expect(stderr).toContain(
      "The token comes from the TASKLESS_TOKEN environment variable, so replace or unset it; `auth login` and `auth logout` do not change it."
    );
    expect(stderr).toContain(
      "runtime rule demo was not run — authentication was rejected, so it was not verified."
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
