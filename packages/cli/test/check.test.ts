import { execFile } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, cp, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");
const fixturesDirectory = resolve(
  import.meta.dirname,
  "fixtures/taskless-project"
);

/** Run the CLI and capture output, allowing non-zero exit codes */
async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const execError = error as {
      stdout: string;
      stderr: string;
      code: number;
    };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: execError.code,
    };
  }
}

describe("check", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-check-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("exits 0 with friendly message when .taskless/ does not exist", async () => {
    const { stdout, exitCode } = await runCli([
      "check",
      "-d",
      temporaryDirectory,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No rules configured");
  });

  it("does not scaffold .taskless/ in a project that has none", async () => {
    // `check` reads; it must not write a scaffold as a side effect of looking
    // for rules — which also keeps it working on a read-only checkout.
    await runCli(["check", "-d", temporaryDirectory]);

    await expect(stat(join(temporaryDirectory, ".taskless"))).rejects.toThrow();
  });

  it("exits 0 with friendly message when rules directory is empty", async () => {
    await mkdir(join(temporaryDirectory, ".taskless", "sg", "rules"), {
      recursive: true,
    });

    const { stdout, exitCode } = await runCli([
      "check",
      "-d",
      temporaryDirectory,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No rules configured");
  });

  it("does not report a Vale-only project as having no rules", async () => {
    // Vale rules alone are rules. Gating the "nothing to run" message on
    // ast-grep and runtime rules only returned before the engines were ever
    // dispatched, so a project whose rules are all Vale's ran nothing and read
    // as unconfigured. Asserted on the message rather than on findings so the
    // test does not depend on the optional Vale binary being installed.
    await mkdir(join(temporaryDirectory, ".taskless", "vale", "rules"), {
      recursive: true,
    });
    await writeFile(
      join(temporaryDirectory, ".taskless", "vale", "rules", "no-simply.yml"),
      `extends: existence\nmessage: "Avoid 'simply'"\nlevel: warning\ntokens:\n  - simply\n`
    );
    await writeFile(
      join(temporaryDirectory, ".taskless", "vale", ".vale.ini"),
      "StylesPath = .\nMinAlertLevel = suggestion\n\n[*.md]\nBasedOnStyles =\nrules.no-simply = YES\n"
    );
    await writeFile(join(temporaryDirectory, "doc.md"), "Just simply do it.\n");

    const { stdout } = await runCli(["check", "-d", temporaryDirectory]);

    expect(stdout).not.toContain("No rules configured");
  });

  it("runs scanner and produces human output for rule matches", async () => {
    await cp(fixturesDirectory, temporaryDirectory, { recursive: true });

    const { stdout, exitCode } = await runCli([
      "check",
      "-d",
      temporaryDirectory,
    ]);
    expect(exitCode).toBe(1); // has error-severity match (no-eval)
    expect(stdout).toContain("no-eval");
    expect(stdout).toContain("eval");
    expect(stdout).toContain("error");
    expect(stdout).toContain("issue");
  });

  it("produces JSON output with --json flag", async () => {
    await cp(fixturesDirectory, temporaryDirectory, { recursive: true });

    const { stdout, exitCode } = await runCli([
      "check",
      "-d",
      temporaryDirectory,
      "--json",
    ]);
    expect(exitCode).toBe(1);

    const parsed = JSON.parse(stdout.trim()) as {
      success: boolean;
      results: Array<{
        source: string;
        ruleId: string;
        severity: string;
        message: string;
        file: string;
        range: unknown;
        matchedText: string;
      }>;
    };

    expect(parsed).toHaveProperty("success");
    expect(parsed).toHaveProperty("results");
    expect(parsed.results.length).toBeGreaterThan(0);

    for (const result of parsed.results) {
      expect(result).toHaveProperty("source", "ast-grep");
      expect(result).toHaveProperty("ruleId");
      expect(result).toHaveProperty("severity");
      expect(result).toHaveProperty("message");
      expect(result).toHaveProperty("file");
      expect(result).toHaveProperty("range");
      expect(result).toHaveProperty("matchedText");
    }
  });

  it("exits 0 for warnings-only, exits 1 for errors", async () => {
    // Create a project with only a warning-level rule
    await mkdir(join(temporaryDirectory, ".taskless", "sg", "rules"), {
      recursive: true,
    });
    await writeFile(
      join(temporaryDirectory, ".taskless", "sg", "rules", "warn-only.yml"),
      [
        "id: no-console-warn",
        "language: javascript",
        "severity: warning",
        "rule:",
        "  pattern: console.warn($$$)",
        "message: Avoid console.warn",
      ].join("\n")
    );
    await writeFile(
      join(temporaryDirectory, "test.js"),
      'console.warn("hello");\n'
    );

    const { exitCode } = await runCli(["check", "-d", temporaryDirectory]);
    expect(exitCode).toBe(0); // warnings only → exit 0
  });

  it("does not require taskless.json to run", async () => {
    await cp(fixturesDirectory, temporaryDirectory, { recursive: true });
    // Remove taskless.json if it exists — check should still work with just rules
    await rm(join(temporaryDirectory, ".taskless", "taskless.json"), {
      force: true,
    });

    const { stdout, exitCode } = await runCli([
      "check",
      "-d",
      temporaryDirectory,
    ]);
    expect(exitCode).toBe(1); // has error-severity match (no-eval)
    expect(stdout).toContain("no-eval");
  });

  it("scans hidden directories without abandoning .gitignore", async () => {
    // ast-grep's walker skips dot-directories by default, so every `sg` rule
    // was blind to `.github/`, `.circleci/`, `.vscode/` and friends — a silent
    // false negative that let `check` exit 0 on a file it flags correctly one
    // directory over. The fix passes `--no-ignore hidden`, and this pins both
    // halves of it: the hidden file is reported, and the gitignored one is
    // still skipped (which `--no-ignore vcs` would have broken).
    await cp(fixturesDirectory, temporaryDirectory, { recursive: true });
    await mkdir(join(temporaryDirectory, ".github", "workflows"), {
      recursive: true,
    });
    await writeFile(
      join(temporaryDirectory, ".github", "workflows", "hook.js"),
      'eval("in-dot-github");\n'
    );
    await mkdir(join(temporaryDirectory, "build"), { recursive: true });
    await writeFile(
      join(temporaryDirectory, "build", "bundle.js"),
      'eval("in-ignored-output");\n'
    );
    await writeFile(join(temporaryDirectory, ".gitignore"), "build/\n");
    // ast-grep reads `.gitignore` only inside a repository, so the negative
    // half of this test needs one to be meaningful.
    await execFileAsync("git", ["init", "-q"], { cwd: temporaryDirectory });

    const { stdout, exitCode } = await runCli([
      "check",
      "-d",
      temporaryDirectory,
      "--json",
    ]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim()) as {
      results: Array<{ file: string }>;
    };
    const files = parsed.results.map((result) => result.file);
    expect(files).toContain(join(".github", "workflows", "hook.js"));
    expect(files).not.toContain(join("build", "bundle.js"));
  });

  it("does not flag the CLI's own rule files under .taskless/", async () => {
    // `.taskless/` is hidden, so scanning it was never intended — it only
    // became reachable when `--no-ignore hidden` was added. Every rule
    // definition is structured YAML carrying `id:`, `language:`, `severity:`,
    // `message:` and `rule:`, so an ordinary user-written Yaml rule fires on
    // the CLI's own config: a false positive in a directory the user cannot
    // edit without disabling their rule. Both halves are asserted, because the
    // exclusion must not undo the hidden-directory fix it rides along with.
    const ruleDirectory = join(
      temporaryDirectory,
      ".taskless",
      "rules",
      "sg",
      "no-severity-key"
    );
    await mkdir(ruleDirectory, { recursive: true });
    await writeFile(
      join(ruleDirectory, "no-severity-key.yml"),
      [
        "id: no-severity-key",
        "language: Yaml",
        "severity: error",
        "rule:",
        "  pattern:",
        '    context: "severity: error"',
        "    selector: block_mapping_pair",
        "message: found a severity key",
      ].join("\n")
    );
    await mkdir(join(temporaryDirectory, ".github", "workflows"), {
      recursive: true,
    });
    await writeFile(
      join(temporaryDirectory, ".github", "workflows", "ci.yml"),
      "name: ci\nseverity: error\n"
    );

    const { stdout, exitCode } = await runCli([
      "check",
      "-d",
      temporaryDirectory,
      "--json",
    ]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim()) as {
      results: Array<{ file: string }>;
    };
    const files = parsed.results.map((result) => result.file);
    // The rule still reaches the hidden directory it is meant to.
    expect(files).toContain(join(".github", "workflows", "ci.yml"));
    // ...but never the rule file that defines it, which says `severity: error`
    // for reasons that have nothing to do with the project being checked.
    expect(files.some((file) => file.includes(".taskless"))).toBe(false);
  });

  describe("positional path arguments", () => {
    it("scans only the specified file when a path is passed", async () => {
      await cp(fixturesDirectory, temporaryDirectory, { recursive: true });
      // Add a second file with a violation that should be EXCLUDED
      await writeFile(
        join(temporaryDirectory, "other.js"),
        'eval("should-not-be-scanned");\n'
      );

      const { stdout, exitCode } = await runCli([
        "check",
        "-d",
        temporaryDirectory,
        "--json",
        "sample.js",
      ]);

      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout.trim()) as {
        results: Array<{ file: string }>;
      };

      // All results should be from sample.js only
      expect(parsed.results.length).toBeGreaterThan(0);
      for (const result of parsed.results) {
        expect(result.file).toContain("sample.js");
        expect(result.file).not.toContain("other.js");
      }
    });

    it("silently filters paths that do not exist", async () => {
      await cp(fixturesDirectory, temporaryDirectory, { recursive: true });

      const { stdout, exitCode } = await runCli([
        "check",
        "-d",
        temporaryDirectory,
        "--json",
        "sample.js",
        "deleted-in-diff.js",
      ]);

      // Still scans sample.js and produces its matches
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout.trim()) as {
        results: Array<{ file: string }>;
      };
      expect(parsed.results.length).toBeGreaterThan(0);
      for (const result of parsed.results) {
        expect(result.file).toContain("sample.js");
      }
    });

    it("exits 0 with empty results when every passed path is missing", async () => {
      await cp(fixturesDirectory, temporaryDirectory, { recursive: true });

      const { stdout, exitCode } = await runCli([
        "check",
        "-d",
        temporaryDirectory,
        "--json",
        "missing-a.js",
        "missing-b.js",
      ]);

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout.trim()) as {
        success: boolean;
        results: unknown[];
      };
      expect(parsed.success).toBe(true);
      expect(parsed.results).toEqual([]);
    });

    it("zero paths keeps full-project scan behavior", async () => {
      await cp(fixturesDirectory, temporaryDirectory, { recursive: true });
      await writeFile(
        join(temporaryDirectory, "extra.js"),
        'eval("also-caught");\n'
      );

      const { stdout, exitCode } = await runCli([
        "check",
        "-d",
        temporaryDirectory,
        "--json",
      ]);

      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout.trim()) as {
        results: Array<{ file: string }>;
      };

      // Both sample.js and extra.js matches present
      const files = new Set(parsed.results.map((r) => r.file));
      expect([...files].some((f) => f.includes("sample.js"))).toBe(true);
      expect([...files].some((f) => f.includes("extra.js"))).toBe(true);
    });

    it("accepts a directory path and scans files under it", async () => {
      await cp(fixturesDirectory, temporaryDirectory, { recursive: true });
      await mkdir(join(temporaryDirectory, "src"), { recursive: true });
      await writeFile(
        join(temporaryDirectory, "src", "nested.js"),
        'eval("in-src");\n'
      );

      const { stdout, exitCode } = await runCli([
        "check",
        "-d",
        temporaryDirectory,
        "--json",
        "src",
      ]);

      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout.trim()) as {
        results: Array<{ file: string }>;
      };

      // Only files under src/ — NOT root-level sample.js
      expect(parsed.results.length).toBeGreaterThan(0);
      for (const result of parsed.results) {
        expect(result.file).toContain("src");
        expect(result.file).not.toMatch(/^sample\.js$/);
      }
    });

    it("treats arguments after `--` as positional paths even if they start with `-`", async () => {
      await cp(fixturesDirectory, temporaryDirectory, { recursive: true });
      // Create a file whose name starts with `-`; without `--`, the CLI
      // would treat it as an unknown flag and fall back to a full scan.
      await writeFile(
        join(temporaryDirectory, "-weird.js"),
        'eval("dash-prefixed");\n'
      );

      const { stdout, exitCode } = await runCli([
        "check",
        "-d",
        temporaryDirectory,
        "--json",
        "--",
        "-weird.js",
      ]);

      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout.trim()) as {
        results: Array<{ file: string }>;
      };

      // Only the `-weird.js` file — sample.js should not be scanned
      expect(parsed.results.length).toBeGreaterThan(0);
      for (const result of parsed.results) {
        expect(result.file).toContain("-weird.js");
        expect(result.file).not.toContain("sample.js");
      }
    });
  });
});
