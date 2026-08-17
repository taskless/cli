import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { hasValeRules, runEngines } from "../src/rules/dispatch";
import { assembleSgConfig, assembleValeConfig } from "../src/rules/assemble";
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
  /**
   * Whether the Vale rule ships a per-rule `.vale.ini`. Without one it enables
   * itself nowhere, so assembly produces no blocks and writes no config — the
   * "rule directory present, nothing to run" state.
   */
  valeConfig?: boolean;
  sgSeverity?: "warning" | "error";
}) {
  const valeRules = options?.valeRules ?? true;
  const valeConfig = options?.valeConfig ?? true;
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
  if (valeRules && valeConfig) {
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
      valeConfigPath: undefined,
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
      valeConfigPath: undefined,
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
      valeConfigPath: undefined,
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
    const valeConfigPath = await assembleValeConfig(cwd);
    const dispatched = await runEngines({
      cwd,
      paths: ["app.js", "doc.md"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      valeConfigPath,
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
      valeConfigPath: await assembleValeConfig(cwd),
      runtimeRules: [],
    });
    expect(dispatched.results.every((result) => result.source !== "vale")).toBe(
      true
    );
    expect(dispatched.notices).toEqual([]);
  });
});

describe("runEngines when a Vale rule directory assembles to nothing", () => {
  // The case the rule-directory layout made reachable, and the reason dispatch
  // gates on the config rather than on `hasValeRules`: a rule directory exists
  // (so the directory count is non-zero) while every rule in it declares no
  // matcher, so assembly writes no file and deletes none. Gating on the
  // directory alone ran Vale against whatever `.taskless/.vale.ini` a previous
  // run had left behind — or against a path that was never written at all.
  it("does not invoke Vale, and reports a clean run", async () => {
    const cwd = makeMixedProject({ valeConfig: false });

    // A rule *directory* is present, so the old gate would have said "run".
    expect(await hasValeRules(cwd)).toBe(true);
    const valeConfigPath = await assembleValeConfig(cwd);
    expect(valeConfigPath).toBeUndefined();

    // Spied rather than inferred from the absence of findings: an unconfigured
    // Vale reports nothing either way, so "no vale results" cannot tell a skip
    // apart from a run against a stale config.
    const run = await import("../src/rules/vale/run");
    const runVale = vi.spyOn(run, "runVale");

    const dispatched = await runEngines({
      cwd,
      paths: ["app.js", "doc.md"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      valeConfigPath,
      runtimeRules: [],
    });

    expect(runVale).not.toHaveBeenCalled();
    expect(dispatched.results.every((result) => result.source !== "vale")).toBe(
      true
    );
    expect(dispatched.notices).toEqual([]);
    expect(dispatched.failures).toEqual([]);
    expect(dispatched.exitCode).toBe(0);
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
      valeConfigPath: await assembleValeConfig(cwd),
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
      valeConfigPath: await assembleValeConfig(cwd),
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
      // Assembled while the directory is still readable: the failure under
      // test is discovery's, not assembly's.
      const valeConfigPath = await assembleValeConfig(cwd);
      const rules = join(cwd, ".taskless", "rules", "vale");
      chmodSync(rules, 0o000);
      try {
        const dispatched = await runEngines({
          cwd,
          paths: ["app.js", "doc.md"],
          astGrepConfigPath: await assembleSgConfig(cwd),
          valeConfigPath,
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
