import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assembleSgConfig } from "../src/rules/assemble";
import { ruleDirectory, ruleTestsDirectory } from "../src/rules/engines";
import { findSgBinary, buildPath } from "../src/rules/scan";

const execFileAsync = promisify(execFile);

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-layout-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const RULE = [
  "id: no-eval",
  "language: TypeScript",
  "severity: error",
  "message: no eval",
  "rule:",
  "  pattern: eval($$$A)",
  "",
].join("\n");

/** A test file is valid test YAML and invalid *rule* YAML — it has no `language`. */
const TEST_FILE = [
  "id: no-eval",
  "valid:",
  '  - "const a = 1"',
  "invalid:",
  '  - "eval(x)"',
  "",
].join("\n");

/**
 * Pins the one undocumented behavior this layout depends on.
 *
 * ast-grep's `ruleDirs` recurses and parses every `.yml` beneath it as a rule,
 * so a rule's tests have to live somewhere the rule walk does not reach. A
 * dot-directory is skipped; `tests/` and `__tests__/` are not, and either fails
 * the whole scan with `missing field 'language'`.
 *
 * The binary is pinned to an exact version, so this cannot change without a
 * deliberate bump — and this test is what fires at that bump, turning the
 * discovery into a migration task with a changelog to read rather than a
 * mystery in someone's CI. If it ever does break, the recorded fallback is to
 * materialize a rules-only tree for ast-grep (design D2).
 */
describe("the .tests/ directory is invisible to ast-grep rule discovery", () => {
  it("scans clean with test YAML inside a rule's .tests/", async () => {
    const rule = ruleDirectory(cwd, "sg", "no-eval");
    await mkdir(rule, { recursive: true });
    await writeFile(join(rule, "no-eval.yml"), RULE);

    const tests = ruleTestsDirectory(cwd, "sg", "no-eval");
    await mkdir(tests, { recursive: true });
    await writeFile(join(tests, "no-eval-20260101-test.yml"), TEST_FILE);

    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), 'const x = eval("1");\n');

    const configPath = await assembleSgConfig(cwd);
    expect(configPath).toBeDefined();

    // ast-grep exits non-zero when it finds error-severity results, which is
    // the success case here — the rule fired. A parse failure is what would
    // make this test meaningful, and that produces no JSON at all.
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        findSgBinary(),
        ["scan", "-c", configPath ?? "", "--json"],
        { cwd, env: { ...process.env, PATH: buildPath() } }
      ));
    } catch (error) {
      stdout = (error as { stdout: string }).stdout;
    }

    // The rule fires, which proves discovery ran; the test file beneath it was
    // never parsed as a rule, which is the property being pinned.
    const findings = JSON.parse(stdout) as { ruleId: string }[];
    expect(findings.map((f) => f.ruleId)).toEqual(["no-eval"]);
  });

  it("would fail if the same file sat in a non-dot directory", async () => {
    const rule = ruleDirectory(cwd, "sg", "no-eval");
    await mkdir(join(rule, "tests"), { recursive: true });
    await writeFile(join(rule, "no-eval.yml"), RULE);
    // Deliberately NOT `.tests/` — this is the layout the dot exists to avoid.
    await writeFile(join(rule, "tests", "no-eval-20260101-test.yml"), TEST_FILE);

    const configPath = await assembleSgConfig(cwd);

    await expect(
      execFileAsync(findSgBinary(), ["scan", "-c", configPath ?? "", "--json"], {
        cwd,
        env: { ...process.env, PATH: buildPath() },
      })
    ).rejects.toThrow();
  });
});
