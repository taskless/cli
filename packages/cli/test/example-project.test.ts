import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

/** `<repo>/example` — the committed demo project. */
const exampleSource = resolve(import.meta.dirname, "../../../example");

const withVale = findValeBinary().path === undefined ? describe.skip : describe;

/**
 * The example project exists so a person can see what an install looks like,
 * rather than infer it from tests that build their own fixtures. These tests
 * are the second half of that bargain: a demo that has drifted from the layout
 * it demonstrates is worse than no demo, so a layout change that breaks it
 * fails the build instead of leaving something misleading in the repository.
 *
 * Run against a copy. `check` triggers migrations and assembles configs, and
 * neither should write into a committed directory during a test run.
 */
let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-example-"));
  await cp(exampleSource, cwd, { recursive: true });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function runCli(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout: string; stderr: string; code: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: failure.code,
    };
  }
}

interface CheckOutput {
  success: boolean;
  results: { source: string; ruleId: string; file: string }[];
}

/** The `--json` line, ignoring any preceding migration notice. */
function parseJson<T>(stdout: string): T {
  const line = stdout
    .trim()
    .split("\n")
    .findLast((entry) => entry.trim().startsWith("{"));
  return JSON.parse(line ?? "{}") as T;
}

interface RuleReport {
  ok: boolean;
  rules: { engine: string; ruleId: string; ok: boolean; errors: string[] }[];
}

withVale("the example project", () => {
  it("reports a finding from each engine", async () => {
    const result = await runCli(["check", "-d", cwd, "--json"]);
    const output = parseJson<CheckOutput>(result.stdout);

    const byRule = new Map(
      output.results.map((finding) => [finding.ruleId, finding])
    );
    expect(byRule.get("no-eval")?.file).toBe("example.cjs");
    expect(byRule.get("no-simply")?.file).toBe("example.html");

    // The README quotes this exact shape. An error-severity finding means the
    // run exits 1, which is what the README says it does.
    expect(result.exitCode).toBe(1);
  });

  it("verifies every rule in the example", async () => {
    const result = await runCli(["verify", "-d", cwd, "--json"]);
    expect(result.exitCode).toBe(0);
    const report = parseJson<RuleReport>(result.stdout);
    expect(report.rules.map((rule) => `${rule.engine}/${rule.ruleId}`)).toEqual(
      ["sg/no-eval", "vale/no-simply"]
    );
  });

  it("passes the rules' own tests", async () => {
    const result = await runCli(["test", "-d", cwd, "--json"]);
    expect(result.exitCode).toBe(0);
    expect(parseJson<RuleReport>(result.stdout).ok).toBe(true);
  });

  // The directory form is what CI runs, and what the README tells a reader to
  // use. Worth asserting separately from the no-argument form.
  it("accepts an engine directory as a path", async () => {
    const result = await runCli([
      "verify",
      ".taskless/rules/vale",
      "-d",
      cwd,
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    expect(parseJson<RuleReport>(result.stdout).rules).toHaveLength(1);
  });

  // The two assembled configs are build output. Finding either committed here
  // would mean the example is teaching people to check in generated files.
  it("commits no assembled config", async () => {
    const result = await runCli(["verify", "-d", cwd, "--json"]);
    expect(result.exitCode).toBe(0);

    // The pathspec is relative to `cwd`, which is already `<repo>/example` —
    // `example/.taskless` resolved to `example/example/.taskless`, matched
    // nothing, and made the assertions below vacuous.
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--", ".taskless"],
      {
        cwd: exampleSource,
      }
    );
    expect(stdout).not.toBe("");

    // Assert on the exact assembled paths, not basenames. A per-rule
    // `.vale.ini` inside a rule directory is a legitimately committed source
    // file — only the two files assembly writes at `.taskless/` are build
    // output.
    const tracked = stdout.split("\n");
    expect(tracked).not.toContain(".taskless/.vale.ini");
    expect(tracked).not.toContain(".taskless/.sgconfig.yml");
  });
});
