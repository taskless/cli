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
import { assembleSgConfig, assembleValeConfig } from "../src/rules/assemble";
import { findValeBinary } from "../src/rules/vale/binary";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";

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
      "[*.md]\ntskl) rule = no-simply\nno-simply.no-simply = YES\n"
    );
  }

  // Declare the schema version this fixture is already written in. Without it
  // the tree reads as version 0, and the migrations dutifully "upgrade" a
  // current-layout project into `.taskless/sg/rules/sg/` — the rules end up
  // somewhere the scanner does not look, so `check` finds nothing and reports
  // success. Only the tests that spawn the CLI run migrations, which is why
  // the in-process `runEngines` tests never noticed.
  writeFileSync(
    join(cwd, ".taskless", "taskless.json"),
    JSON.stringify({ version: LATEST_SCHEMA_VERSION, install: {} })
  );

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
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
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
      vale: undefined,
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
      vale: undefined,
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
      vale: undefined,
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
    const assembledVale = await assembleValeConfig(cwd);
    const dispatched = await runEngines({
      cwd,
      paths: ["app.js", "doc.md"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      vale: assembledVale,
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
    const assembledVale = await assembleValeConfig(cwd);
    const dispatched = await runEngines({
      cwd,
      paths: ["app.js", "doc.md"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      vale: assembledVale,
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
    const assembledVale = await assembleValeConfig(cwd);
    expect(assembledVale).toBeUndefined();

    // Spied rather than inferred from the absence of findings: an unconfigured
    // Vale reports nothing either way, so "no vale results" cannot tell a skip
    // apart from a run against a stale config.
    const run = await import("../src/rules/vale/run");
    const runVale = vi.spyOn(run, "runVale");

    const dispatched = await runEngines({
      cwd,
      paths: ["app.js", "doc.md"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      vale: assembledVale,
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
      source: undefined,
      tried: ["@taskless/vale-darwin-arm64", "PATH"],
    });

    const cwd = makeMixedProject();
    const assembledVale = await assembleValeConfig(cwd);
    const dispatched = await runEngines({
      cwd,
      paths: ["app.js", "doc.md"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      vale: assembledVale,
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
      notices: [],
    });

    const cwd = makeMixedProject();
    const assembledVale = await assembleValeConfig(cwd);
    const dispatched = await runEngines({
      cwd,
      paths: ["doc.md"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      vale: assembledVale,
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
      const assembledVale = await assembleValeConfig(cwd);
      const rules = join(cwd, ".taskless", "rules", "vale");
      chmodSync(rules, 0o000);
      try {
        const dispatched = await runEngines({
          cwd,
          paths: ["app.js", "doc.md"],
          astGrepConfigPath: await assembleSgConfig(cwd),
          vale: assembledVale,
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

describe("config advisories ride on every Vale outcome", () => {
  // The schema's advisories are decided at assembly, before Vale runs, so
  // whether the author hears them cannot depend on how Vale's own run went.
  // Vale is mocked because the shape under test is dispatch's merge, not the
  // binary; each case drives one branch of `runValeEngine`.
  const ADVISED_CONFIG =
    "[*.md]\ntskl) rule = no-simply\nno-simply.no-simply = YES\n\n" +
    "[.taskless/**]\ntskl) rule = no-simply\nno-simply.no-simply = NO\n";

  async function dispatchWithAdvisory(
    outcome: Awaited<
      ReturnType<(typeof import("../src/rules/vale/run"))["runVale"]>
    >
  ) {
    const run = await import("../src/rules/vale/run");
    vi.spyOn(run, "runVale").mockResolvedValue(outcome);
    const cwd = makeMixedProject();
    writeFileSync(
      join(cwd, ".taskless", "rules", "vale", "no-simply", ".vale.ini"),
      ADVISED_CONFIG
    );
    const assembledVale = await assembleValeConfig(cwd);
    return runEngines({
      cwd,
      paths: ["doc.md"],
      astGrepConfigPath: await assembleSgConfig(cwd),
      vale: assembledVale,
      runtimeRules: [],
    });
  }

  it("carries Vale's own zero-exit diagnostic beside the schema advisory", async () => {
    const dispatched = await dispatchWithAdvisory({
      status: "ok",
      blocking: false,
      results: [],
      notices: ["W101 something Vale said"],
    });
    // TWO elements, not one string carrying both. The schema advisory and
    // Vale's own diagnostic are independent notices, and a producer that
    // joined them — with "\n", "; " or anything else — would fail here.
    expect(dispatched.notices).toHaveLength(2);
    expect(dispatched.notices[0]).toContain("[.taskless/**]");
    expect(dispatched.notices[1]).toBe("W101 something Vale said");
    expect(dispatched.notices.some((notice) => notice.includes("\n"))).toBe(
      false
    );
    expect(dispatched.failures).toEqual([]);
  });

  it("survives a Vale timeout as a notice beside the failure", async () => {
    // The case a reviewer caught: the blocking branch used to return only the
    // failure, so an advisory was heard only on runs where Vale did not crash.
    const dispatched = await dispatchWithAdvisory({
      status: "timeout",
      blocking: true,
      message: "Vale timed out after 1ms",
    });
    expect(dispatched.failures).toEqual(["Vale timed out after 1ms"]);
    expect(dispatched.notices).toHaveLength(1);
    expect(dispatched.notices[0]).toContain("[.taskless/**]");
    // An advisory is not what failed the run, so it is not in the failure.
    expect(dispatched.failures[0]).not.toContain("[.taskless/**]");
    expect(dispatched.exitCode).toBe(1);
  });

  it("carries the skip notice beside the unavailable message", async () => {
    const dispatched = await dispatchWithAdvisory({
      status: "unavailable",
      blocking: false,
      message: "Vale binary not found",
    });
    // Two independent notices, two elements. The advisory is about the config
    // and the message is about the binary; gluing them into one string made
    // `check` render the second without its `Notice: ` marker.
    expect(dispatched.notices).toHaveLength(2);
    expect(dispatched.notices[0]).toContain("[.taskless/**]");
    expect(dispatched.notices[1]).toContain("Vale binary not found");
    expect(dispatched.failures).toEqual([]);
    expect(dispatched.exitCode).toBe(0);
  });
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
    mkdirSync(join(cwd, ".taskless", "rules", "sg", "broken"), {
      recursive: true,
    });
    writeFileSync(
      join(cwd, ".taskless", "rules", "sg", "broken", "broken.yml"),
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

withVale("a repository containing a converter-dependent file", () => {
  it("still reports its Markdown findings, and says what it skipped", async () => {
    // End to end, through the built CLI, because the failure this covers was
    // whole-run: one `.adoc` aborted Vale before it serialized anything, so
    // every Markdown finding in the project disappeared while `check` still
    // exited non-zero for an unrelated ast-grep finding — a dead engine
    // wearing a normal red check.
    const cwd = makeMixedProject();
    // Widen the rule past `[*.md]`. Vale only routes a file to a parser when
    // the configuration gives it a check to run, so the crash is unreachable
    // while every matcher is Markdown-only.
    writeFileSync(
      join(cwd, ".taskless", "rules", "vale", "no-simply", ".vale.ini"),
      "[*]\ntskl) rule = no-simply\nno-simply.no-simply = YES\n"
    );
    writeFileSync(join(cwd, "guide.adoc"), "= Guide\n\nJust simply do it.\n");
    mkdirSync(join(cwd, "docs"), { recursive: true });
    writeFileSync(join(cwd, "docs", "api.rst"), "API\n===\n\nsimply\n");

    const { stdout } = await runCli(["check", "-d", cwd, "--json"]);
    const output = parseJson(stdout);

    // The findings survive...
    expect(
      output.results.some(
        (result) => (result as { source?: string }).source === "vale"
      )
    ).toBe(true);
    // ...and it is a skip, not an engine failure.
    expect(output.failures).toBeUndefined();
    // ...and the skip is said out loud, naming both the file and the fix.
    const notices = (output.notices ?? []).join("\n");
    expect(notices).toContain("guide.adoc");
    expect(notices).toContain("docs/api.rst");
    expect(notices).toContain("asciidoctor");
    expect(notices).toContain("rst2html");
  });
});

/** A project whose two Vale rules each draw a repeated-key advisory. */
function makeTwoAdvisoryProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "vale-notices-"));
  workspaces.push(cwd);
  mkdirSync(join(cwd, ".taskless", "rules", "vale"), { recursive: true });
  for (const ruleId of ["no-simply", "no-twist"] as const) {
    const token = ruleId === "no-simply" ? "simply" : "twist";
    mkdirSync(join(cwd, ".taskless", "rules", "vale", ruleId), {
      recursive: true,
    });
    writeFileSync(
      join(cwd, ".taskless", "rules", "vale", ruleId, `${ruleId}.yml`),
      `extends: existence\nmessage: "Avoid '${token}'"\nlevel: warning\ntokens:\n  - ${token}\n`
    );
    // The repeat has to be within ONE matcher, which is what the config
    // schema says something about. `[docs/**]` keeps the rule enabled
    // somewhere, so the repeat under `[*.md]` stays an advisory rather than
    // becoming a rejection for a rule that is off everywhere.
    writeFileSync(
      join(cwd, ".taskless", "rules", "vale", ruleId, ".vale.ini"),
      `[docs/**]\ntskl) rule = ${ruleId}\n${ruleId}.${ruleId} = YES\n\n` +
        `[*.md]\ntskl) rule = ${ruleId}\n${ruleId}.${ruleId} = YES\n` +
        `${ruleId}.${ruleId} = NO\n`
    );
  }
  writeFileSync(
    join(cwd, ".taskless", "taskless.json"),
    JSON.stringify({ version: LATEST_SCHEMA_VERSION, install: {} })
  );
  writeFileSync(join(cwd, "doc.md"), "Just simply do it.\n");
  return cwd;
}

/**
 * `check` renders one marker per notice, on stderr.
 *
 * The defect these cover was user-visible and lived in `check` alone. Every
 * producer used to glue its advisories into ONE string with `"\n"`, and
 * `check` printed `Notice: ` once per element — so a run with two advisories
 * printed the first behind a marker and the second as a bare, unindented line
 * with nothing marking it as a notice. `verify` had the same bug and it was
 * fixed in `241e1c4`; `check` kept it.
 *
 * Driven through the built CLI over a real project rather than through
 * `runEngines`, because the renderer is what regressed and it lives in the
 * command. Two Vale rules each carrying a config advisory is the smallest
 * project that produces two independent notices, and it needs no Vale binary:
 * the advisories come from the config schema at assembly time, so they are on
 * the result whether Vale then runs or reports itself unavailable.
 */
describe("check renders one marker per notice", () => {
  it("gives each advisory its own Notice: line in text output", async () => {
    const cwd = makeTwoAdvisoryProject();
    const { stderr } = await runCli(["check", "-d", cwd]);

    const advisoryLines = stderr
      .split("\n")
      .filter((line) => line.includes("assigns"));

    // Two advisories, two lines, each marked. Before the fix these arrived as
    // one `"\n"`-joined element and printed as one marked line plus one stray.
    expect(advisoryLines).toHaveLength(2);
    for (const line of advisoryLines) {
      expect(line.startsWith("Notice: ")).toBe(true);
    }
    expect(advisoryLines.some((line) => line.includes("no-simply"))).toBe(true);
    expect(advisoryLines.some((line) => line.includes("no-twist"))).toBe(true);
  });

  it("publishes them as separate --json elements, none spanning lines", async () => {
    const cwd = makeTwoAdvisoryProject();
    const { stdout } = await runCli(["check", "-d", cwd, "--json"]);
    const notices = parseJson(stdout).notices ?? [];

    expect(notices.filter((notice) => notice.includes("assigns"))).toHaveLength(
      2
    );
    // The half a consumer sees. A `"\n"` inside an element means several
    // notices were shipped as one, and nothing published the separator that
    // would let the consumer split them back apart.
    for (const notice of notices) {
      expect(notice).not.toContain("\n");
    }
  });
});
