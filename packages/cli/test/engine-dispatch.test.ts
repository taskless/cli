import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureTasklessDirectory } from "../src/filesystem/directory";
import {
  dedupeFindings,
  discoverAstGrepRuleSources,
  planEngineDispatch,
  resolveIngestEngine,
} from "../src/rules/engines";
import { writeRuleFile, writeRuleTestFile } from "../src/rules/files";
import {
  discoverRuntimeRules,
  discoverRuntimeRulesIn,
} from "../src/rules/runtime/discover";
import {
  reportRuntimeChecks,
  signRuntimeChecks,
} from "../src/rules/runtime/run-set";
import type { GeneratedRule } from "../src/api/rules";
import type { CheckResult } from "../src/types/check";
import { CLIError } from "../src/util/cli-error";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

const NO_EVAL_RULE = [
  "id: no-eval",
  "language: typescript",
  "severity: error",
  "rule:",
  "  pattern: eval($A)",
  "message: avoid eval",
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

const RUNTIME_CHECK = "export default async function () {\n  return [];\n}\n";

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
  results: { source: string; ruleId: string; file: string }[];
} {
  const line = stdout
    .trim()
    .split("\n")
    .findLast((l) => l.trim().startsWith("{"));
  return JSON.parse(line ?? "{}") as {
    success: boolean;
    results: { source: string; ruleId: string; file: string }[];
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

/** A `.taskless/` already at the current schema, so migrations are a no-op. */
async function seedMigratedProject(root: string): Promise<string> {
  const tasklessDirectory = join(root, ".taskless");
  await mkdir(tasklessDirectory, { recursive: true });
  await ensureTasklessDirectory(root);
  return tasklessDirectory;
}

describe("engine dispatch by directory", () => {
  let temporaryDirectory: string;
  let tasklessDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "tskl-engines-"));
    tasklessDirectory = await seedMigratedProject(temporaryDirectory);
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("routes each known engine directory to its executor", async () => {
    const dispatch = await planEngineDispatch(temporaryDirectory);
    const byEngine = new Map(dispatch.map((entry) => [entry.engine, entry]));

    expect(byEngine.get("sg")).toMatchObject({
      present: true,
      executor: "ast-grep",
    });
    expect(byEngine.get("runtime")).toMatchObject({
      present: true,
      executor: "runtime-harness",
    });
    // Scaffolded, recognized, but nothing executes it yet.
    expect(byEngine.get("vale")).toMatchObject({
      present: true,
      executor: null,
    });
  });

  it("ignores a directory that is not a known engine", async () => {
    await mkdir(join(tasklessDirectory, "eslint", "rules"), {
      recursive: true,
    });
    await writeFile(
      join(tasklessDirectory, "eslint", "rules", "no-eval.yml"),
      NO_EVAL_RULE,
      "utf8"
    );

    const dispatch = await planEngineDispatch(temporaryDirectory);
    expect(dispatch.map((entry) => entry.engine)).toEqual([
      "sg",
      "vale",
      "runtime",
    ]);

    // Its rules are never picked up as ast-grep sources.
    const sources = await discoverAstGrepRuleSources(temporaryDirectory);
    expect(
      sources.every((source) => !source.rulesDirectory.includes("eslint"))
    ).toBe(true);
  });

  it("finds ast-grep rules under sg/rules by directory alone", async () => {
    await writeFile(
      join(tasklessDirectory, "sg", "rules", "no-eval.yml"),
      NO_EVAL_RULE,
      "utf8"
    );

    const sources = await discoverAstGrepRuleSources(temporaryDirectory);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      rulesDirectory: "sg/rules",
      ruleTestsDirectory: "sg/rule-tests",
      legacy: false,
      ruleIds: ["no-eval"],
    });
  });

  it("treats the legacy rules/ path as an ast-grep source", async () => {
    await mkdir(join(tasklessDirectory, "rules"), { recursive: true });
    await writeFile(
      join(tasklessDirectory, "rules", "no-eval.yml"),
      NO_EVAL_RULE,
      "utf8"
    );

    const sources = await discoverAstGrepRuleSources(temporaryDirectory);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ rulesDirectory: "rules", legacy: true });
  });

  it("returns both layouts, engine directory first, when both hold rules", async () => {
    await writeFile(
      join(tasklessDirectory, "sg", "rules", "no-eval.yml"),
      NO_EVAL_RULE,
      "utf8"
    );
    await mkdir(join(tasklessDirectory, "rules"), { recursive: true });
    await writeFile(
      join(tasklessDirectory, "rules", "no-eval.yml"),
      NO_EVAL_RULE,
      "utf8"
    );

    const sources = await discoverAstGrepRuleSources(temporaryDirectory);
    expect(sources.map((source) => source.rulesDirectory)).toEqual([
      "sg/rules",
      "rules",
    ]);
  });

  it("omits a rules directory that holds no rule files", async () => {
    // The scaffold creates sg/rules with only a .gitkeep in it.
    const sources = await discoverAstGrepRuleSources(temporaryDirectory);
    expect(sources).toEqual([]);
  });

  it("discovers a runtime rule under runtime/rules/ and nothing else", async () => {
    const runtimeRule = join(
      tasklessDirectory,
      "runtime",
      "rules",
      "logs-abc12345"
    );
    await mkdir(runtimeRule, { recursive: true });
    await writeFile(join(runtimeRule, "logs.yml"), RUNTIME_CAPTURE, "utf8");
    await writeFile(join(runtimeRule, "check.ts"), RUNTIME_CHECK, "utf8");

    const discovered = await discoverRuntimeRules(temporaryDirectory);
    expect(discovered.map((rule) => rule.name)).toEqual(["logs-abc12345"]);
    expect(discovered[0]?.checkFile).toBe(join(runtimeRule, "check.ts"));
  });

  it("treats a rule under sg/rules/ as static, never runtime", async () => {
    // Same capture shape, filed under the ast-grep engine: the directory
    // decides, so runtime discovery must not pick it up.
    await writeFile(
      join(tasklessDirectory, "sg", "rules", "logs.yml"),
      RUNTIME_CAPTURE,
      "utf8"
    );
    await writeFile(
      join(tasklessDirectory, "sg", "rules", "check.ts"),
      RUNTIME_CHECK,
      "utf8"
    );

    expect(await discoverRuntimeRules(temporaryDirectory)).toEqual([]);
    const sources = await discoverAstGrepRuleSources(temporaryDirectory);
    expect(sources.map((source) => source.rulesDirectory)).toEqual([
      "sg/rules",
    ]);
  });

  it("does not discover runtime rules left at the pre-migration path", async () => {
    // 0004 moves this tree; a leftover here is not a second runtime source.
    const legacy = join(tasklessDirectory, "runtime-rules", "logs-abc12345");
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "logs.yml"), RUNTIME_CAPTURE, "utf8");
    await writeFile(join(legacy, "check.ts"), RUNTIME_CHECK, "utf8");

    expect(await discoverRuntimeRules(temporaryDirectory)).toEqual([]);
  });
});

function finding(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    source: "ast-grep",
    ruleId: "no-eval",
    severity: "error",
    message: "avoid eval",
    file: "src.ts",
    range: {
      start: { line: 1, column: 0 },
      end: { line: 1, column: 9 },
    },
    matchedText: "eval(one)",
    ...overrides,
  };
}

describe("finding de-duplication", () => {
  it("collapses identical matches reported by two sources", () => {
    expect(dedupeFindings([finding(), finding()])).toHaveLength(1);
  });

  it("keeps distinct matches", () => {
    const other = finding({
      range: { start: { line: 9, column: 0 }, end: { line: 9, column: 9 } },
    });
    expect(dedupeFindings([finding(), other])).toHaveLength(2);
  });
});

describe("check dispatches by directory end to end", () => {
  let temporaryDirectory: string;
  let tasklessDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "tskl-dispatch-e2e-"));
    tasklessDirectory = await seedMigratedProject(temporaryDirectory);
    await writeFile(
      join(temporaryDirectory, "src.ts"),
      'eval("danger");\n',
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("runs a rule under sg/rules", async () => {
    await writeFile(
      join(tasklessDirectory, "sg", "rules", "no-eval.yml"),
      NO_EVAL_RULE,
      "utf8"
    );

    const { stdout, exitCode } = await runCli([
      "check",
      "-d",
      temporaryDirectory,
      "--json",
    ]);
    const output = parseJson(stdout);
    expect(exitCode).toBe(1); // error severity
    expect(output.results.map((r) => r.ruleId)).toEqual(["no-eval"]);
  });

  it("runs a rule that a producer wrote to the legacy rules/ path", async () => {
    await mkdir(join(tasklessDirectory, "rules"), { recursive: true });
    await writeFile(
      join(tasklessDirectory, "rules", "no-eval.yml"),
      NO_EVAL_RULE,
      "utf8"
    );

    const { stdout } = await runCli([
      "check",
      "-d",
      temporaryDirectory,
      "--json",
    ]);
    expect(parseJson(stdout).results.map((r) => r.ruleId)).toEqual(["no-eval"]);
  });

  it("merges both layouts without reporting the same match twice", async () => {
    await writeFile(
      join(tasklessDirectory, "sg", "rules", "no-eval.yml"),
      NO_EVAL_RULE,
      "utf8"
    );
    await mkdir(join(tasklessDirectory, "rules"), { recursive: true });
    await writeFile(
      join(tasklessDirectory, "rules", "no-eval.yml"),
      NO_EVAL_RULE,
      "utf8"
    );

    const { stdout } = await runCli([
      "check",
      "-d",
      temporaryDirectory,
      "--json",
    ]);
    const results = parseJson(stdout).results;
    expect(results).toHaveLength(1);
    expect(results[0]?.ruleId).toBe("no-eval");
  });

  it("triggers the migration even though no sgconfig is generated first", async () => {
    // A pre-0004 project: check must relayout it before scanning.
    const legacy = await mkdtemp(join(tmpdir(), "tskl-dispatch-legacy-"));
    try {
      await mkdir(join(legacy, ".taskless", "rules"), { recursive: true });
      await writeFile(
        join(legacy, ".taskless", "taskless.json"),
        JSON.stringify({ version: 3 }),
        "utf8"
      );
      await writeFile(
        join(legacy, ".taskless", "rules", "no-eval.yml"),
        NO_EVAL_RULE,
        "utf8"
      );
      await writeFile(join(legacy, "src.ts"), 'eval("danger");\n', "utf8");

      const { stdout } = await runCli(["check", "-d", legacy, "--json"]);

      expect(parseJson(stdout).results.map((r) => r.ruleId)).toEqual([
        "no-eval",
      ]);
      expect(
        await exists(join(legacy, ".taskless", "sg", "rules", "no-eval.yml"))
      ).toBe(true);
    } finally {
      await rm(legacy, { recursive: true, force: true });
    }
  });
});

describe("service-delivered rule ingest", () => {
  let temporaryDirectory: string;
  let tasklessDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "tskl-ingest-"));
    tasklessDirectory = await seedMigratedProject(temporaryDirectory);
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const rule = {
    id: "no-eval",
    content: { id: "no-eval", language: "typescript" },
    tests: { valid: ["ok()"], invalid: ["eval(1)"] },
  } as unknown as GeneratedRule;

  it("files an engine-less payload under sg/", async () => {
    const rulePath = await writeRuleFile(temporaryDirectory, rule);
    const testPath = await writeRuleTestFile(
      temporaryDirectory,
      rule,
      "20260730"
    );

    expect(rulePath).toBe(
      join(tasklessDirectory, "sg", "rules", "no-eval.yml")
    );
    expect(testPath).toBe(
      join(tasklessDirectory, "sg", "rule-tests", "no-eval-20260730-test.yml")
    );
  });

  it("lands a delivered rule where the migration puts the same rule", async () => {
    // Migrated: seeded at the legacy path, moved by 0004.
    const migrated = await mkdtemp(join(tmpdir(), "tskl-ingest-migrated-"));
    try {
      await mkdir(join(migrated, ".taskless", "rules"), { recursive: true });
      await writeFile(
        join(migrated, ".taskless", "taskless.json"),
        JSON.stringify({ version: 3 }),
        "utf8"
      );
      await writeFile(
        join(migrated, ".taskless", "rules", "no-eval.yml"),
        NO_EVAL_RULE,
        "utf8"
      );
      await ensureTasklessDirectory(migrated);

      const delivered = await writeRuleFile(temporaryDirectory, rule);

      // Both come to rest at the same `.taskless/`-relative path.
      expect(relative(temporaryDirectory, delivered)).toBe(
        join(".taskless", "sg", "rules", "no-eval.yml")
      );
      expect(
        await exists(join(migrated, ".taskless", "sg", "rules", "no-eval.yml"))
      ).toBe(true);
    } finally {
      await rm(migrated, { recursive: true, force: true });
    }
  });

  it("refuses an engine the CLI does not recognize and writes nothing", async () => {
    const unknown = { ...rule, engine: "semgrep" } as unknown as GeneratedRule;

    await expect(writeRuleFile(temporaryDirectory, unknown)).rejects.toThrow(
      /semgrep/
    );
    await expect(writeRuleFile(temporaryDirectory, unknown)).rejects.toThrow(
      CLIError
    );

    // Nothing under any engine directory.
    for (const engine of ["sg", "vale", "runtime"]) {
      const entries = await readdir(join(tasklessDirectory, engine, "rules"));
      expect(entries.filter((entry) => entry !== ".gitkeep")).toEqual([]);
    }
  });

  it("resolves engines directly: absent is sg, known passes through", () => {
    expect(resolveIngestEngine({})).toBe("sg");
    expect(resolveIngestEngine({ engine: "" })).toBe("sg");
    expect(resolveIngestEngine({ engine: "sg" })).toBe("sg");
    expect(resolveIngestEngine({ engine: "vale" })).toBe("vale");
    expect(() => resolveIngestEngine({ engine: "nope" })).toThrow(/nope/);
  });
});

describe("reconcile compatibility across the relayout", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "tskl-reconcile-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("keeps signatures identical and reports the moved path", async () => {
    const tasklessDirectory = join(temporaryDirectory, ".taskless");
    const legacyRule = join(tasklessDirectory, "runtime-rules", "demo");
    await mkdir(legacyRule, { recursive: true });
    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({ version: 3 }),
      "utf8"
    );
    await writeFile(join(legacyRule, "logs.yml"), RUNTIME_CAPTURE, "utf8");
    await writeFile(join(legacyRule, "check.ts"), RUNTIME_CHECK, "utf8");

    const before = await signRuntimeChecks(
      await discoverRuntimeRulesIn(join(tasklessDirectory, "runtime-rules"))
    );
    const beforeReport = reportRuntimeChecks(temporaryDirectory, before.signed);

    await ensureTasklessDirectory(temporaryDirectory);

    const after = await signRuntimeChecks(
      await discoverRuntimeRulesIn(join(tasklessDirectory, "runtime", "rules"))
    );
    const afterReport = reportRuntimeChecks(temporaryDirectory, after.signed);

    // The path follows the moved tree...
    expect(beforeReport[0]?.file).toBe(".taskless/runtime-rules/demo/check.ts");
    expect(afterReport[0]?.file).toBe(".taskless/runtime/rules/demo/check.ts");
    // ...while the signature — what the server joins on — does not change.
    expect(afterReport[0]?.signature).toBe(beforeReport[0]?.signature);
  });
});
