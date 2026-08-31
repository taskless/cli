import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureTasklessDirectory } from "../src/filesystem/directory";
import {
  listRuleIds,
  planEngineDispatch,
  resolveIngestEngine,
  ruleDirectory,
} from "../src/rules/engines";
import {
  deleteRuleFiles,
  writeRuleFile,
  writeRuleTestFile,
} from "../src/rules/files";
import { verifyOneRule } from "../src/rules/inspect";
import {
  discoverRuntimeRules,
  discoverRuntimeRulesIn,
} from "../src/rules/runtime/discover";
import {
  reportRuntimeChecks,
  signRuntimeChecks,
} from "../src/rules/runtime/run-set";
import type { GeneratedRule } from "../src/api/rules";
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
    // Vale gained its executor with the Vale engine; before that this was
    // `null` because the directory was scaffolded but inert.
    expect(byEngine.get("vale")).toMatchObject({
      present: true,
      executor: "vale-runner",
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

    // Its rules are never picked up as ast-grep rules.
    expect(await listRuleIds(temporaryDirectory, "sg")).toEqual([]);
  });

  it("finds ast-grep rules by their directory alone", async () => {
    const rule = ruleDirectory(temporaryDirectory, "sg", "no-eval");
    await mkdir(rule, { recursive: true });
    await writeFile(join(rule, "no-eval.yml"), NO_EVAL_RULE, "utf8");

    expect(await listRuleIds(temporaryDirectory, "sg")).toEqual(["no-eval"]);
  });

  // A rule is a directory. A loose file in the engine directory is not one, and
  // treating it as a rule would resurrect the flat layout by accident.
  it("ignores a loose file in an engine directory", async () => {
    await mkdir(join(tasklessDirectory, "rules", "sg"), { recursive: true });
    await writeFile(
      join(tasklessDirectory, "rules", "sg", "no-eval.yml"),
      NO_EVAL_RULE,
      "utf8"
    );

    expect(await listRuleIds(temporaryDirectory, "sg")).toEqual([]);
  });

  // Assembly order is a correctness constraint: Vale precedence is positional,
  // so a directory-iteration order would give a rule a different effective
  // scope per machine.
  it("returns rule ids sorted", async () => {
    for (const id of ["zebra", "alpha", "middle"]) {
      const rule = ruleDirectory(temporaryDirectory, "sg", id);
      await mkdir(rule, { recursive: true });
      await writeFile(join(rule, `${id}.yml`), NO_EVAL_RULE, "utf8");
    }
    expect(await listRuleIds(temporaryDirectory, "sg")).toEqual([
      "alpha",
      "middle",
      "zebra",
    ]);
  });

  it("reports no rules for a freshly scaffolded project", async () => {
    expect(await listRuleIds(temporaryDirectory, "sg")).toEqual([]);
  });

  it("discovers a runtime rule with its captures and nothing else", async () => {
    const runtimeRule = ruleDirectory(
      temporaryDirectory,
      "runtime",
      "logs-abc12345"
    );
    await mkdir(join(runtimeRule, "captures"), { recursive: true });
    await writeFile(
      join(runtimeRule, "captures", "logs.yml"),
      RUNTIME_CAPTURE,
      "utf8"
    );
    await writeFile(join(runtimeRule, "check.ts"), RUNTIME_CHECK, "utf8");

    const discovered = await discoverRuntimeRules(temporaryDirectory);
    expect(discovered.map((rule) => rule.name)).toEqual(["logs-abc12345"]);
    expect(discovered[0]?.checkFile).toBe(join(runtimeRule, "check.ts"));
  });

  it("treats a rule under the sg engine as static, never runtime", async () => {
    // Same capture shape, filed under the ast-grep engine: the directory
    // decides, so runtime discovery must not pick it up.
    const rule = ruleDirectory(temporaryDirectory, "sg", "logs");
    await mkdir(join(rule, "captures"), { recursive: true });
    await writeFile(
      join(rule, "captures", "logs.yml"),
      RUNTIME_CAPTURE,
      "utf8"
    );
    await writeFile(join(rule, "check.ts"), RUNTIME_CHECK, "utf8");

    expect(await discoverRuntimeRules(temporaryDirectory)).toEqual([]);
    expect(await listRuleIds(temporaryDirectory, "sg")).toEqual(["logs"]);
  });

  it.each(["sg", "vale", "runtime"] as const)(
    "deletes a %s rule by bare id",
    async (engine) => {
      // `delete` takes an id with no engine, so it has to find which of the
      // three sibling trees holds it. This assumed `sg`, which meant a
      // delivered vale or runtime rule could be written and never removed —
      // and reported "not found" for a rule plainly on disk.
      const directory = ruleDirectory(
        temporaryDirectory,
        engine,
        "logs-abc12345"
      );
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "marker.txt"), "x", "utf8");

      expect(await deleteRuleFiles(temporaryDirectory, "logs-abc12345")).toBe(
        true
      );
      expect(existsSync(directory)).toBe(false);
    }
  );

  it("propagates a real IO error instead of reporting the rule absent", async () => {
    // `EACCES` on a rule directory is not "no rule here". Reading it as
    // absence would tell the user to treat a rule that exists, and is merely
    // unreadable, as gone — the same class of bug this search exists to fix.
    const directory = ruleDirectory(
      temporaryDirectory,
      "vale",
      "logs-abc12345"
    );
    await mkdir(directory, { recursive: true });
    await chmod(dirname(directory), 0o000);
    try {
      await expect(
        deleteRuleFiles(temporaryDirectory, "logs-abc12345")
      ).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      await chmod(dirname(directory), 0o755);
    }
  });

  it("reports not-found for an id no engine holds", async () => {
    expect(await deleteRuleFiles(temporaryDirectory, "absent-abc12345")).toBe(
      false
    );
  });

  it.each([
    ["broad", 1],
    ["anchor", 1],
    // Unimplemented modes. `anchor` is NOT a safe fallback for either: the
    // capture would run as a narrow, match a fraction of what it was written
    // for, and report the shortfall as a pass.
    ["whole-repo", 0],
    ["ANCHOR", 0],
    ["", 0],
  ])("loads a %s capture into %i rule(s)", async (mode, expected) => {
    const rule = ruleDirectory(temporaryDirectory, "runtime", "logs-abc12345");
    await mkdir(join(rule, "captures"), { recursive: true });
    await writeFile(
      join(rule, "captures", "logs.yml"),
      RUNTIME_CAPTURE.replace("match: anchor", `match: ${mode}`),
      "utf8"
    );
    await writeFile(join(rule, "check.ts"), RUNTIME_CHECK, "utf8");

    expect(await discoverRuntimeRules(temporaryDirectory)).toHaveLength(
      expected
    );
  });

  it("keeps the good captures of a rule that also has an unknown mode", async () => {
    // The refusal is per capture, not per rule: one unimplemented mode must
    // not take the rule's other narrows down with it.
    const rule = ruleDirectory(temporaryDirectory, "runtime", "logs-abc12345");
    await mkdir(join(rule, "captures"), { recursive: true });
    await writeFile(
      join(rule, "captures", "good.yml"),
      RUNTIME_CAPTURE,
      "utf8"
    );
    await writeFile(
      join(rule, "captures", "bad.yml"),
      RUNTIME_CAPTURE.replace("match: anchor", "match: whole-repo"),
      "utf8"
    );
    await writeFile(join(rule, "check.ts"), RUNTIME_CHECK, "utf8");

    const [discovered] = await discoverRuntimeRules(temporaryDirectory);
    expect(discovered?.captureRules.map((c) => c.fileName)).toEqual([
      "good.yml",
    ]);
  });

  it("verify names the unimplemented mode, so the skipped capture is explained", async () => {
    // Discovery refusing the capture is only half the fix. On its own the rule
    // reports nothing, which reads as a pass; `verify` is where the author is
    // told why, and it must name the file and the offending value.
    const rule = ruleDirectory(temporaryDirectory, "runtime", "logs-abc12345");
    await mkdir(join(rule, "captures"), { recursive: true });
    await writeFile(
      join(rule, "captures", "logs.yml"),
      RUNTIME_CAPTURE.replace("match: anchor", "match: whole-repo"),
      "utf8"
    );
    await writeFile(join(rule, "check.ts"), RUNTIME_CHECK, "utf8");

    const result = await verifyOneRule(temporaryDirectory, {
      engine: "runtime",
      ruleId: "logs-abc12345",
    } as Parameters<typeof verifyOneRule>[1]);

    expect(result.ok).toBe(false);
    const message = result.errors.join("\n");
    expect(message).toContain("captures/logs.yml");
    expect(message).toContain("whole-repo");
    // The valid modes are listed, so the author does not have to go looking.
    expect(message).toContain("anchor");
    expect(message).toContain("broad");
  });

  // Every reason discovery refuses a capture. Each was a silent `continue`:
  // the capture vanished from the run and `check` exited 0, which is
  // indistinguishable from a rule that found nothing.
  const REFUSALS: [label: string, yaml: string, expected: RegExp][] = [
    ["not a mapping", "just a string\n", /not a YAML mapping/],
    [
      "no taskless block",
      RUNTIME_CAPTURE.split("metadata:")[0] ?? "",
      /no metadata\.taskless block/,
    ],
    [
      "wrong kind",
      RUNTIME_CAPTURE.replace("kind: runtime", "kind: static"),
      /kind: "static", not "runtime"/,
    ],
    [
      "unimplemented metadata version",
      RUNTIME_CAPTURE.replace("version: 1", "version: 99"),
      /version 99, which this build does not implement/,
    ],
    [
      "no language",
      RUNTIME_CAPTURE.replace("language: typescript\n", ""),
      /no string `language`/,
    ],
    [
      "no name",
      RUNTIME_CAPTURE.replace("    name: logs\n", ""),
      /no string metadata\.taskless\.name/,
    ],
    [
      "no id",
      RUNTIME_CAPTURE.replace("id: logs-abc12345\n", ""),
      /no string `id`/,
    ],
  ];

  it.each(REFUSALS)(
    "refuses a capture that is %s, and verify says why",
    async (_label, yaml, expected) => {
      const rule = ruleDirectory(
        temporaryDirectory,
        "runtime",
        "logs-abc12345"
      );
      await mkdir(join(rule, "captures"), { recursive: true });
      await writeFile(join(rule, "captures", "logs.yml"), yaml, "utf8");
      await writeFile(join(rule, "check.ts"), RUNTIME_CHECK, "utf8");

      // Fails closed: the capture is not loaded, so the rule has none and is
      // not a runtime rule at all.
      expect(await discoverRuntimeRules(temporaryDirectory)).toHaveLength(0);

      // ...and says so. Discovery refusing silently would just be a different
      // route to "reports nothing".
      const result = await verifyOneRule(temporaryDirectory, {
        engine: "runtime",
        ruleId: "logs-abc12345",
      } as Parameters<typeof verifyOneRule>[1]);
      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toMatch(expected);
    }
  );

  it("does not discover runtime rules left at the pre-migration path", async () => {
    // 0004 moves this tree; a leftover here is not a second runtime source.
    const legacy = join(tasklessDirectory, "runtime-rules", "logs-abc12345");
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "logs.yml"), RUNTIME_CAPTURE, "utf8");
    await writeFile(join(legacy, "check.ts"), RUNTIME_CHECK, "utf8");

    expect(await discoverRuntimeRules(temporaryDirectory)).toEqual([]);
  });
});

describe("check dispatches by directory end to end", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "tskl-dispatch-e2e-"));
    await seedMigratedProject(temporaryDirectory);
    await writeFile(
      join(temporaryDirectory, "src.ts"),
      'eval("danger");\n',
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("runs a rule from its rule directory", async () => {
    const rule = ruleDirectory(temporaryDirectory, "sg", "no-eval");
    await mkdir(rule, { recursive: true });
    await writeFile(join(rule, "no-eval.yml"), NO_EVAL_RULE, "utf8");

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
        await exists(
          join(legacy, ".taskless", "rules", "sg", "no-eval", "no-eval.yml")
        )
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
      join(tasklessDirectory, "rules", "sg", "no-eval", "no-eval.yml")
    );
    expect(testPath).toBe(
      join(
        tasklessDirectory,
        "rules",
        "sg",
        "no-eval",
        ".tests",
        "no-eval-20260730-test.yml"
      )
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
        join(".taskless", "rules", "sg", "no-eval", "no-eval.yml")
      );
      expect(
        await exists(
          join(migrated, ".taskless", "rules", "sg", "no-eval", "no-eval.yml")
        )
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
      const entries = await readdir(join(tasklessDirectory, "rules", engine));
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

    // Discovery reads the current layout only, so the pre-migration tree
    // cannot be discovered — it is described directly. What the test is about
    // is the signature, which is computed over `check.ts` bytes and must
    // survive the move.
    const before = await signRuntimeChecks([
      {
        name: "demo",
        dir: legacyRule,
        captureRules: [],
        checkFile: join(legacyRule, "check.ts"),
      },
    ]);
    const beforeReport = reportRuntimeChecks(temporaryDirectory, before.signed);

    await ensureTasklessDirectory(temporaryDirectory);

    const after = await signRuntimeChecks(
      await discoverRuntimeRulesIn(join(tasklessDirectory, "rules", "runtime"))
    );
    const afterReport = reportRuntimeChecks(temporaryDirectory, after.signed);

    // The path follows the moved tree...
    expect(beforeReport[0]?.file).toBe(".taskless/runtime-rules/demo/check.ts");
    expect(afterReport[0]?.file).toBe(".taskless/rules/runtime/demo/check.ts");
    // ...while the signature — what the server joins on — does not change.
    expect(afterReport[0]?.signature).toBe(beforeReport[0]?.signature);
  });
});
