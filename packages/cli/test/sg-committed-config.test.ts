import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureTasklessDirectory } from "../src/filesystem/directory";
import { verifyRule } from "../src/rules/verify";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

/** `.taskless/sgconfig.yml` — written only when a rule set has no committed config. */
const EPHEMERAL_CONFIG = ["sgconfig.yml"];

function rule(id: string, pattern: string): string {
  return [
    `id: ${id}`,
    "language: typescript",
    "severity: error",
    "rule:",
    `  pattern: ${pattern}`,
    `message: avoid ${id}`,
    "",
  ].join("\n");
}

function ruleTest(id: string, valid: string, invalid: string): string {
  return [
    `id: ${id}`,
    "valid:",
    `  - ${valid}`,
    "invalid:",
    `  - ${invalid}`,
    "",
  ].join("\n");
}

async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      binPath,
      ...args,
    ]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    // `code` is a number for a normal exit, but null when the child was killed
    // by a signal and a string for spawn failures (e.g. ENOENT) — coerce so a
    // signal death cannot read as exit 0.
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string | null;
    };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: typeof execError.code === "number" ? execError.code : 1,
    };
  }
}

function parseJson(stdout: string): {
  success: boolean;
  results: { ruleId: string }[];
} {
  const line = stdout
    .trim()
    .split("\n")
    .findLast((l) => l.trim().startsWith("{"));
  return JSON.parse(line ?? "{}") as {
    success: boolean;
    results: { ruleId: string }[];
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("ast-grep runs over the committed sg config", () => {
  let temporaryDirectory: string;
  let tasklessDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "tskl-sg-config-"));
    await ensureTasklessDirectory(temporaryDirectory);
    tasklessDirectory = join(temporaryDirectory, ".taskless");
    await writeFile(
      join(temporaryDirectory, "src.ts"),
      'eval("danger");\nwith (x) {}\n',
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("scans without generating an ephemeral config", async () => {
    await writeFile(
      join(tasklessDirectory, "sg", "rules", "no-eval.yml"),
      rule("no-eval", "eval($A)"),
      "utf8"
    );

    const { stdout, exitCode } = await runCli([
      "check",
      "-d",
      temporaryDirectory,
      "--json",
    ]);

    expect(exitCode).toBe(1);
    expect(parseJson(stdout).results.map((r) => r.ruleId)).toEqual(["no-eval"]);
    // The committed config is the source of truth; nothing is written for it.
    expect(await exists(join(tasklessDirectory, ...EPHEMERAL_CONFIG))).toBe(
      false
    );
  });

  it("honours a rule directory the committed config declares", async () => {
    // A second ruleDirs entry, of the kind a human or the generator authors.
    await writeFile(
      join(tasklessDirectory, "sg", "sgconfig.yml"),
      "ruleDirs:\n  - rules\n  - extra\ntestConfigs:\n  - testDir: rule-tests\n",
      "utf8"
    );
    await writeFile(
      join(tasklessDirectory, "sg", "rules", "no-eval.yml"),
      rule("no-eval", "eval($A)"),
      "utf8"
    );
    await mkdir(join(tasklessDirectory, "sg", "extra"), { recursive: true });
    await writeFile(
      join(tasklessDirectory, "sg", "extra", "no-with.yml"),
      rule("no-with", "with ($A) { $$$B }"),
      "utf8"
    );

    const { stdout } = await runCli([
      "check",
      "-d",
      temporaryDirectory,
      "--json",
    ]);

    // Both run: the config was read as written, not reconstructed from the
    // directory listing.
    expect(
      parseJson(stdout)
        .results.map((r) => r.ruleId)
        .toSorted()
    ).toEqual(["no-eval", "no-with"]);
  });

  it("generates a config only for the pre-migration layout", async () => {
    await mkdir(join(tasklessDirectory, "rules"), { recursive: true });
    await writeFile(
      join(tasklessDirectory, "rules", "no-eval.yml"),
      rule("no-eval", "eval($A)"),
      "utf8"
    );

    const { stdout } = await runCli([
      "check",
      "-d",
      temporaryDirectory,
      "--json",
    ]);

    expect(parseJson(stdout).results.map((r) => r.ruleId)).toEqual(["no-eval"]);
    // That layout has no committed config of its own, so one is written for it.
    expect(await exists(join(tasklessDirectory, ...EPHEMERAL_CONFIG))).toBe(
      true
    );
  });

  it("verifies a rule against the committed config and sg/rule-tests", async () => {
    await writeFile(
      join(tasklessDirectory, "sg", "rules", "no-eval.yml"),
      rule("no-eval", "eval($$$)"),
      "utf8"
    );
    await writeFile(
      join(tasklessDirectory, "sg", "rule-tests", "no-eval-20260801-test.yml"),
      ruleTest("no-eval", "const x = 1;", "eval('alert(1)')"),
      "utf8"
    );

    const result = await verifyRule(temporaryDirectory, "no-eval");

    expect(result.tests.errors).toEqual([]);
    expect(result.tests.valid).toBe(true);
    expect(result.tests.passed).toBe(1);
    expect(result.success).toBe(true);
    // `sg test` read the committed config — nothing was generated.
    expect(await exists(join(tasklessDirectory, ...EPHEMERAL_CONFIG))).toBe(
      false
    );
  });
});

describe("ast-grep binary is missing", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "tskl-sg-missing-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("prints an error and exits 1", async () => {
    // Run the bundled CLI from outside the workspace with an empty PATH, so
    // every candidate location misses: the platform package no longer resolves,
    // there is no node_modules/.bin beside it, and PATH holds nothing.
    //
    // The child gets a *minimal* env rather than an override on top of
    // `process.env`. Inheriting the parent's environment leaks `NODE_PATH` and
    // `HOME` into module resolution — node consults `$HOME/.node_modules` — so
    // on a machine where either points at a real ast-grep the resolver finds
    // one, the scan succeeds, and the test fails asserting an error that never
    // needed to be printed.
    const isolated = join(temporaryDirectory, "cli");
    const project = join(temporaryDirectory, "project");
    const emptyPath = join(temporaryDirectory, "empty");
    await mkdir(isolated, { recursive: true });
    await mkdir(emptyPath, { recursive: true });
    await mkdir(project, { recursive: true });
    await copyFile(binPath, join(isolated, "index.js"));

    await ensureTasklessDirectory(project);
    await writeFile(
      join(project, ".taskless", "sg", "rules", "no-eval.yml"),
      rule("no-eval", "eval($A)"),
      "utf8"
    );
    await writeFile(join(project, "src.ts"), 'eval("danger");\n', "utf8");

    let stderr = "";
    let stdout = "";
    let exitCode = 0;
    try {
      const result = await execFileAsync(
        process.execPath,
        [join(isolated, "index.js"), "check", "-d", project],
        {
          env: {
            PATH: emptyPath,
            HOME: emptyPath,
            // Telemetry would otherwise try to reach the network from a test.
            TASKLESS_TELEMETRY_DISABLED: "1",
          },
        }
      );
      stdout = result.stdout;
    } catch (error) {
      const execError = error as {
        stderr: string;
        stdout: string;
        code: number;
      };
      stderr = execError.stderr ?? "";
      stdout = execError.stdout ?? "";
      exitCode = execError.code;
    }

    // Named so a failure reports which path the CLI actually took: finding a
    // binary makes this the findings path (exit 1, empty stderr), which looks
    // identical to the error path on the exit code alone.
    expect(exitCode).toBe(1);
    expect(
      stderr,
      `stderr was empty; the CLI printed to stdout instead:\n${stdout}`
    ).toContain("ast-grep binary not found");
  });
});
