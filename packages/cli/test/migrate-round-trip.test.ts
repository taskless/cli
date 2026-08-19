import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

const withVale = findValeBinary().path === undefined ? describe.skip : describe;

/**
 * The behavioral half of the migration.
 *
 * `migrate-engine-layout.test.ts` asserts where files land and that their bytes
 * survive. Both can be perfect while the migrated project reports nothing:
 * 0004's Vale config enables a check named `rules.<id>`, and under 0005's
 * `StylesPath` the same rule resolves as `<id>.<id>` instead. Carrying the old
 * assignment forward therefore leaves every Vale rule present, valid, enabled
 * against a check that does not exist, and silent. That shipped once and was
 * caught by hand, by noticing ast-grep still reported while Vale had gone
 * quiet — file-placement assertions could not see it.
 *
 * So these run the real CLI over a migrated project and ask the only question
 * that matters to a user upgrading: do my rules still fire, and do my tests
 * still run?
 */
const CAPTURE_YML = `id: no-eval-capture\nlanguage: typescript\nrule:\n  pattern: eval($$$ARGS)\n`;
const CHECK_TS = `export function check() {\n  return { ok: true };\n}\n`;

let cwd: string;
let tasklessDirectory: string;

async function writeTree(
  root: string,
  files: Record<string, string>
): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

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

/** The `--json` line, ignoring the migration notice printed above it. */
function parseJson<T>(stdout: string): T {
  const line = stdout
    .trim()
    .split("\n")
    .findLast((entry) => entry.trim().startsWith("{"));
  return JSON.parse(line ?? "{}") as T;
}

interface CheckOutput {
  results: { ruleId: string; file: string }[];
}

interface RuleReport {
  ok: boolean;
  rules: { engine: string; ruleId: string; ok: boolean; errors: string[] }[];
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-roundtrip-"));
  tasklessDirectory = join(cwd, ".taskless");
  await mkdir(tasklessDirectory, { recursive: true });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/**
 * A project as 0004 leaves it: engine-partitioned, flat rule files, one shared
 * Vale config whose assignments use the `rules.` style prefix.
 */
async function seedVersion4Project(): Promise<void> {
  await writeFile(
    join(tasklessDirectory, "taskless.json"),
    JSON.stringify({ version: 4, install: {} }),
    "utf8"
  );
  await writeTree(tasklessDirectory, {
    "sg/sgconfig.yml":
      "ruleDirs:\n  - rules\ntestConfigs:\n  - testDir: rule-tests\n",
    "sg/rules/no-eval.yml":
      "id: no-eval\nlanguage: typescript\nseverity: error\nmessage: Avoid eval.\nrule:\n  pattern: eval($A)\n",
    "sg/rule-tests/no-eval-20260101-test.yml":
      "id: no-eval\nvalid:\n  - safeParse(raw)\ninvalid:\n  - eval(raw)\n",

    "vale/.vale.ini":
      "StylesPath = rules\nMinAlertLevel = suggestion\n\n[*.md]\ntskl) rule = no-simply\nBasedOnStyles =\nrules.no-simply = YES\n",
    "vale/rules/no-simply.yml":
      "extends: existence\nmessage: \"Avoid '%s'\"\nlevel: warning\nignorecase: true\ntokens:\n  - simply\n",
    "vale/rule-tests/no-simply/fail/bad.md": "You simply do it.\n",
    "vale/rule-tests/no-simply/pass/ok.md": "You do it.\n",

    "runtime/rules/no-eval-runtime/capture.yml": CAPTURE_YML,
    "runtime/rules/no-eval-runtime/check.ts": CHECK_TS,
  });

  // The code and prose the rules have something to say about.
  await writeFile(join(cwd, "app.ts"), "eval(raw);\n", "utf8");
  await writeFile(join(cwd, "doc.md"), "You simply do it.\n", "utf8");
}

withVale("a version-4 project upgraded through 0005", () => {
  it("still reports a finding from each static engine", async () => {
    await seedVersion4Project();

    const result = await runCli(["check", "-d", cwd, "--json"]);
    const byRule = new Map(
      parseJson<CheckOutput>(result.stdout).results.map((finding) => [
        finding.ruleId,
        finding.file,
      ])
    );

    // The ast-grep half is the control. It reported before the migration and
    // reports after, so a silent Vale is visible as a difference between the
    // two engines rather than as a plausibly-empty run.
    expect(byRule.get("no-eval")).toBe("app.ts");
    expect(byRule.get("no-simply")).toBe("doc.md");
  });

  it("retargets the Vale assignment from rules.<id> to <id>.<id>", async () => {
    await seedVersion4Project();
    await runCli(["check", "-d", cwd, "--json"]);

    const config = await readFile(
      join(tasklessDirectory, "rules", "vale", "no-simply", ".vale.ini"),
      "utf8"
    );
    expect(config).toContain("no-simply.no-simply = YES");
    expect(config).not.toContain("rules.no-simply");
    // The matcher and its breadcrumb come through untouched.
    expect(config).toContain("[*.md]");
    expect(config).toContain("tskl) rule = no-simply");
  });

  it("still verifies every migrated rule", async () => {
    await seedVersion4Project();

    const result = await runCli(["verify", "-d", cwd, "--json"]);
    const report = parseJson<RuleReport>(result.stdout);
    // Engine order follows the `ENGINES` declaration, not the alphabet.
    expect(report.rules.map((rule) => `${rule.engine}/${rule.ruleId}`)).toEqual(
      ["sg/no-eval", "vale/no-simply", "runtime/no-eval-runtime"]
    );
    expect(report.rules.flatMap((rule) => rule.errors)).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it("still runs the tests that moved with their rules", async () => {
    await seedVersion4Project();

    const result = await runCli(["test", "-d", cwd, "--json"]);
    expect(parseJson<RuleReport>(result.stdout).ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  // Runtime capture bytes determine the server-side reconciliation hash, so a
  // migration that rewrote them would invalidate every signature and silently
  // stop the runtime tier from running at all.
  it("leaves runtime capture and check bytes identical", async () => {
    await seedVersion4Project();
    const before = {
      capture: await sha256(
        join(tasklessDirectory, "runtime/rules/no-eval-runtime/capture.yml")
      ),
      check: await sha256(
        join(tasklessDirectory, "runtime/rules/no-eval-runtime/check.ts")
      ),
    };

    await runCli(["check", "-d", cwd, "--json"]);

    const moved = join(
      tasklessDirectory,
      "rules",
      "runtime",
      "no-eval-runtime"
    );
    expect(await sha256(join(moved, "captures", "capture.yml"))).toBe(
      before.capture
    );
    expect(await sha256(join(moved, "check.ts"))).toBe(before.check);
  });

  it("is a no-op the second time", async () => {
    await seedVersion4Project();
    await runCli(["check", "-d", cwd, "--json"]);
    const first = await readFile(
      join(tasklessDirectory, "rules", "vale", "no-simply", ".vale.ini"),
      "utf8"
    );

    const second = await runCli(["check", "-d", cwd, "--json"]);
    expect(second.stdout).not.toContain("Migrating");
    expect(
      await readFile(
        join(tasklessDirectory, "rules", "vale", "no-simply", ".vale.ini"),
        "utf8"
      )
    ).toBe(first);
  });
});

/**
 * A project already in the current layout whose `taskless.json` is missing.
 *
 * `readRawManifest` reports version 0 for an absent manifest, so every
 * migration runs — including `0004`, whose `rules/` → `sg/rules/` move
 * predates the layout this tree is already in. Unguarded it buries the rules
 * at `sg/rules/sg/<id>/`, `0005` scaffolds empty engine directories over the
 * gap, and `check` reports a clean pass on a project it no longer scans.
 *
 * Deliberately outside `withVale`: ast-grep alone is enough to see whether the
 * rules survived, and this is the case that must never regress silently.
 */
describe("a current-layout project with no taskless.json", () => {
  it("still finds its rules instead of reporting a clean pass", async () => {
    await writeTree(tasklessDirectory, {
      "rules/sg/no-eval/no-eval.yml":
        "id: no-eval\nlanguage: typescript\nseverity: error\nmessage: Avoid eval.\nrule:\n  pattern: eval($A)\n",
      "rules/vale/.gitkeep": "",
      "rules/runtime/.gitkeep": "",
    });
    await writeFile(join(cwd, "app.ts"), "eval(raw);\n", "utf8");

    const result = await runCli(["check", "-d", cwd, "--json"]);

    expect(
      parseJson<CheckOutput>(result.stdout).results.map(
        (finding) => `${finding.ruleId}:${finding.file}`
      )
    ).toContain("no-eval:app.ts");
    // An error-severity match is exit 1. Exit 0 here is the bug: a project
    // whose rules were moved out from under it looks indistinguishable from a
    // project that passes.
    expect(result.exitCode).toBe(1);
  });

  it("leaves the rule where the current layout puts it", async () => {
    await writeTree(tasklessDirectory, {
      "rules/sg/no-eval/no-eval.yml":
        "id: no-eval\nlanguage: typescript\nseverity: error\nmessage: Avoid eval.\nrule:\n  pattern: eval($A)\n",
      "rules/vale/.gitkeep": "",
      "rules/runtime/.gitkeep": "",
    });

    await runCli(["check", "-d", cwd, "--json"]);

    const verified = await runCli(["verify", "-d", cwd, "--json"]);
    const report = parseJson<RuleReport>(verified.stdout);
    expect(report.rules.map((rule) => `${rule.engine}/${rule.ruleId}`)).toEqual(
      ["sg/no-eval"]
    );
  });
});
