import { execFile } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { hasValeRules, runEngines } from "../src/rules/dispatch";
import {
  assembleSgConfig,
  assembleValeConfig,
} from "../src/rules/assemble";
import { findValeBinary } from "../src/rules/vale/binary";

const withVale = findValeBinary().path === undefined ? describe.skip : describe;

/**
 * Tests that need mode bits to actually deny a read. Windows does not honour
 * them and root bypasses them, so the directory would stay readable and the
 * test would assert nothing.
 */
const readableModes =
  process.platform === "win32" || process.getuid?.() === 0 ? it.skip : it;

const workspaces: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (workspaces.length > 0) {
    rmSync(workspaces.pop() as string, { recursive: true, force: true });
  }
});

/** A project with an sg rule, a vale rule, and a document tripping both. */
function makeMixedProject(options?: {
  valeRules?: boolean;
  sgSeverity?: "warning" | "error";
}) {
  const valeRules = options?.valeRules ?? true;
  const sgSeverity = options?.sgSeverity ?? "warning";
  const cwd = mkdtempSync(join(tmpdir(), "vale-orch-"));
  workspaces.push(cwd);

  mkdirSync(join(cwd, ".taskless", "rules", "sg", "no-eval"), {
    recursive: true,
  });
  writeFileSync(
    join(cwd, ".taskless", "rules", "sg", "no-eval", "no-eval.yml"),
    [
      "id: no-eval",
      "language: javascript",
      `severity: ${sgSeverity}`,
      "message: Avoid eval",
      "rule:",
      "  pattern: eval($$$ARGS)",
      "",
    ].join("\n")
  );

  // A rule is a directory; each `write` below creates its own.
  if (valeRules) {
    mkdirSync(join(cwd, ".taskless", "rules", "vale", "no-simply"), {
      recursive: true,
    });
    writeFileSync(
      join(cwd, ".taskless", "rules", "vale", "no-simply", "no-simply.yml"),
      `extends: existence\nmessage: "Avoid 'simply'"\nlevel: warning\ntokens:\n  - simply\n`
    );
  }
  // The per-rule config assembly reads. Written only when the rule exists, so
  // a project with no Vale rules assembles to nothing.
  if (valeRules) {
    writeFileSync(
      join(cwd, ".taskless", "rules", "vale", "no-simply", ".vale.ini"),
      "[*.md]\ntskl) rule = no-simply\nBasedOnStyles =\nno-simply.no-simply = YES\n"
    );
  }

  writeFileSync(join(cwd, "app.js"), "eval('1 + 1');\n");
  writeFileSync(join(cwd, "doc.md"), "Just simply do it.\n");
  return cwd;
}

/** The committed config `makeMixedProject` writes, as `check` would resolve it. */

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

/** Run the built CLI, tolerating a non-zero exit. */
async function runCli(
  args: string[]
): Promise<{ stdout: string; exitCode: number }> {
  try {
    const { stdout } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, exitCode: 0 };
  } catch (error) {
    const execError = error as { stdout: string; code: number };
    return { stdout: execError.stdout ?? "", exitCode: execError.code };
  }
}

/** The `--json` line, ignoring any preceding migration notice. */
function parseJson(stdout: string): {
  success: boolean;
  results: unknown[];
  failures?: string[];
  notices?: string[];
} {
  const line = stdout
    .trim()
    .split("\n")
    .findLast((entry) => entry.trim().startsWith("{"));
  return JSON.parse(line ?? "{}") as {
    success: boolean;
    results: unknown[];
    failures?: string[];
    notices?: string[];
  };
}

describe("hasValeRules", () => {
  it("is false for a scaffolded-but-empty rules directory", async () => {
    // The common state after `taskless init`. Spawning Vale per check to
    // confirm it found nothing is pure cost.
    expect(await hasValeRules(makeMixedProject({ valeRules: false }))).toBe(
      false
    );
  });

  it("is true once a rule file exists", async () => {
    expect(await hasValeRules(makeMixedProject())).toBe(true);
  });

  readableModes(
    "propagates a rules directory that exists but cannot be read",
    async () => {
      // Only absence means "no rules". An unreadable directory answered
      // `false` would skip Vale with no notice and no failure, which is the
      // silent-disable the engine's failure/notice split exists to prevent.
      const cwd = makeMixedProject();
      const rules = join(cwd, ".taskless", "rules", "vale");
      chmodSync(rules, 0o000);
      try {
        await expect(hasValeRules(cwd)).rejects.toThrow(/EACCES|EPERM/);
      } finally {
        // Restore before teardown, or the workspace cannot be removed.
        chmodSync(rules, 0o755);
      }
    }
  );
});

describe("exit code carried on the dispatch result", () => {
  // Exercised through `runEngines` rather than against a pure helper, because
  // the exit code is now a property of a completed dispatch. These use no Vale
  // rules, so they run on every host regardless of the optional binary.

  it("is 0 when every finding is a warning", async () => {
    const cwd = makeMixedProject({ valeRules: false });
    const dispatched = await runEngines({
      cwd,
      paths: ["app.js"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      runtimeRules: [],
    });
    expect(dispatched.results.length).toBeGreaterThan(0);
    expect(dispatched.exitCode).toBe(0);
  });

  it("is 1 for an error-severity finding", async () => {
    const cwd = makeMixedProject({ valeRules: false, sgSeverity: "error" });
    const dispatched = await runEngines({
      cwd,
      paths: ["app.js"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      runtimeRules: [],
    });
    expect(
      dispatched.results.some((finding) => finding.severity === "error")
    ).toBe(true);
    expect(dispatched.exitCode).toBe(1);
  });

  it("is 0 for a clean run with nothing to report", async () => {
    const cwd = makeMixedProject({ valeRules: false });
    const dispatched = await runEngines({
      cwd,
      paths: ["doc.md"], // the sg rule is javascript-only, so nothing matches
      astGrepConfigPath: await assembleSgConfig(cwd),
      runtimeRules: [],
    });
    expect(dispatched.results).toEqual([]);
    expect(dispatched.failures).toEqual([]);
    expect(dispatched.exitCode).toBe(0);
  });
});

withVale("runEngines over a mixed corpus", () => {
  it("runs every executor and merges their findings into one set", async () => {
    const cwd = makeMixedProject();
    // Vale reads the assembled run config, so a dispatch that never assembles
    // has no config to point at — which would report as "no Vale findings".
    await assembleValeConfig(cwd);
    const dispatched = await runEngines({
      cwd,
      paths: ["app.js", "doc.md"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      runtimeRules: [],
    });

    const sources = new Set(dispatched.results.map((result) => result.source));
    expect(sources).toContain("ast-grep");
    expect(sources).toContain("vale");
    expect(dispatched.failures).toEqual([]);
    // One merged set, not per-engine buckets the caller has to reassemble.
    expect(dispatched.results.length).toBeGreaterThanOrEqual(2);
  });

  it("does not invoke Vale when it has no rules", async () => {
    const cwd = makeMixedProject({ valeRules: false });
    const dispatched = await runEngines({
      cwd,
      paths: ["app.js", "doc.md"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      runtimeRules: [],
    });
    expect(dispatched.results.every((result) => result.source !== "vale")).toBe(
      true
    );
    expect(dispatched.notices).toEqual([]);
  });
});

describe("runEngines when Vale is unavailable", () => {
  it("still returns ast-grep results, and notices rather than fails", async () => {
    // The requirement in one test: `.taskless/vale/` has rules, the binary is
    // absent, and the check still reports what ast-grep found.
    const binary = await import("../src/rules/vale/binary");
    vi.spyOn(binary, "findValeBinary").mockReturnValue({
      path: undefined,
      tried: ["@taskless/vale-darwin-arm64", "PATH"],
    });

    const cwd = makeMixedProject();
    const dispatched = await runEngines({
      cwd,
      paths: ["app.js", "doc.md"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      runtimeRules: [],
    });

    expect(
      dispatched.results.some((result) => result.source === "ast-grep")
    ).toBe(true);
    expect(dispatched.notices).toHaveLength(1);
    expect(dispatched.notices[0]).toContain("Vale binary not found");
    // A skip, not a failure: the exit code is unaffected.
    expect(dispatched.failures).toEqual([]);
    expect(dispatched.exitCode).toBe(0);
  });

  it("keeps a thrown engine from discarding the others' results", async () => {
    // allSettled, not all: `all` rejects on the first rejection and abandons
    // the rest, so one engine throwing would throw away findings the others
    // had already produced.
    const scan = await import("../src/rules/scan");
    vi.spyOn(scan, "runAstGrepScan").mockRejectedValue(
      new Error("ast-grep exploded")
    );

    // Vale is mocked rather than run: what is under test is that one engine's
    // rejection does not discard another's results, which has nothing to do
    // with whether the optional Vale binary is installed. Left real, this
    // asserted `source === "vale"` on every machine but only passed on the
    // ones that happened to have the binary.
    const run = await import("../src/rules/vale/run");
    vi.spyOn(run, "runVale").mockResolvedValue({
      status: "ok",
      blocking: false,
      results: [
        {
          source: "vale",
          ruleId: "mocked-vale-rule",
          severity: "warning",
          message: "Avoid 'simply'",
          file: "doc.md",
          range: {
            start: { line: 1, column: 6 },
            end: { line: 1, column: 12 },
          },
          matchedText: "simply",
        },
      ],
    });

    const cwd = makeMixedProject();
    const dispatched = await runEngines({
      cwd,
      paths: ["doc.md"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      runtimeRules: [],
    });

    // Vale's findings survive the other engine's rejection...
    expect(
      dispatched.results.some((result) => result.ruleId === "mocked-vale-rule")
    ).toBe(true);
    // ...and the thrown engine is reported as a failure rather than swallowed.
    expect(dispatched.failures).toHaveLength(1);
    expect(dispatched.failures[0]).toContain("ast-grep exploded");
    expect(dispatched.exitCode).toBe(1);
  });

  readableModes(
    "reports an unreadable Vale rules directory as an engine failure",
    async () => {
      // The other half of the rule above: the throw from discovery reaches
      // `failures` and the exit code, instead of Vale quietly contributing
      // nothing and the run reading as clean.
      const cwd = makeMixedProject();
      const rules = join(cwd, ".taskless", "rules", "vale");
      chmodSync(rules, 0o000);
      try {
        const dispatched = await runEngines({
          cwd,
          paths: ["app.js", "doc.md"],
          astGrepConfigPath: await assembleSgConfig(cwd),
          runtimeRules: [],
        });

        expect(dispatched.failures).toHaveLength(1);
        expect(dispatched.failures[0]).toContain("vale engine failed");
        expect(dispatched.exitCode).toBe(1);
      } finally {
        chmodSync(rules, 0o755);
      }
    }
  );
});

describe("an engine failure under --json", () => {
  it("reaches the machine envelope, not only the suppressed warning", async () => {
    // `warn()` is a no-op under `--json`, so without a field for it the
    // consumer sees `{"success":false,"results":[]}` and cannot tell a broken
    // engine from a clean run. A CI script reading that treats a dead engine
    // as a pass.
    const cwd = makeMixedProject({ valeRules: false });
    // An unparseable rule file: ast-grep exits non-zero and the engine fails
    // with no findings, the exact shape that used to read as clean.
    writeFileSync(
      join(cwd, ".taskless", "sg", "rules", "broken.yml"),
      "id: broken\nlanguage: javascript\nrule:\n  bogusKey: nope\n"
    );

    const { stdout, exitCode } = await runCli(["check", "-d", cwd, "--json"]);
    const output = parseJson(stdout);

    expect(exitCode).toBe(1);
    expect(output.success).toBe(false);
    expect(output.results).toEqual([]);
    expect(output.failures).toHaveLength(1);
    expect(output.failures?.[0]).toContain("sg engine failed");
  });

  it("omits both fields when nothing failed, as `skipped` does", async () => {
    const cwd = makeMixedProject({ valeRules: false });
    const { stdout } = await runCli(["check", "-d", cwd, "doc.md", "--json"]);
    const output = parseJson(stdout);

    expect(output.success).toBe(true);
    expect(output.failures).toBeUndefined();
    expect(output.notices).toBeUndefined();
  });
});
