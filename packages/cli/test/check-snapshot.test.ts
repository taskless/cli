import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assembleEngineConfigs } from "../src/rules/assemble";
import { runEngines } from "../src/rules/dispatch";
import { reportRules } from "../src/rules/report";
import { openRun, type RunDirectory } from "../src/rules/run-directory";
import type { CheckResult } from "../src/types/check";
import { canonicalHash } from "../src/rules/rule-hash";
import {
  excludeFromSnapshot,
  fromProjectRoot,
  takeSnapshot,
} from "../src/rules/snapshot";

/** Runs opened by a test, closed after it so no signal handler outlives it. */
const runs: RunDirectory[] = [];

/** Take a snapshot inside a fresh run directory, as `check` does. */
async function snap(cwd: string) {
  const run = await openRun(cwd);
  runs.push(run);
  return takeSnapshot(cwd, run);
}

afterEach(async () => {
  for (const run of runs.splice(0)) await run.close();
});

describe("the check snapshot", () => {
  let cwd: string;
  const rules = () => join(cwd, ".taskless", "rules");

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "tskl-snapshot-"));
    await mkdir(join(rules(), "sg", "no-eval-3fa9c21b", ".tests"), {
      recursive: true,
    });
    await writeFile(
      join(rules(), "sg", "no-eval-3fa9c21b", "no-eval-3fa9c21b.yml"),
      "id: no-eval-3fa9c21b\n"
    );
    await writeFile(
      join(rules(), "sg", "no-eval-3fa9c21b", ".tests", "case.ts"),
      "eval(x);\n"
    );
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("mirrors the project layout under the base, and ignores itself", async () => {
    const snapshot = await snap(cwd);
    expect(snapshot.base).toBe(join(runs.at(-1)!.path, "snapshot"));
    expect(
      existsSync(
        join(
          snapshot.base,
          ".taskless",
          "rules",
          "sg",
          "no-eval-3fa9c21b",
          "no-eval-3fa9c21b.yml"
        )
      )
    ).toBe(true);
    // Ignored from inside, so `check` never rewrites a tracked file.
    expect(
      await readFile(join(cwd, ".taskless", ".run", ".gitignore"), "utf8")
    ).toBe("*\n");
    expect(existsSync(join(cwd, ".taskless", ".gitignore"))).toBe(false);
    expect(fromProjectRoot(snapshot, ".taskless/.vale.ini")).toBe(
      join(runs.at(-1)!.relativePath, "snapshot", ".taskless", ".vale.ini")
    );
  });

  it("is what gets signed: an edit after the snapshot does not reach the report", async () => {
    const snapshot = await snap(cwd);
    await writeFile(
      join(rules(), "sg", "no-eval-3fa9c21b", "no-eval-3fa9c21b.yml"),
      "id: edited\n"
    );
    const report = await reportRules(snapshot);
    expect(report.rules[0]?.files).toEqual([
      {
        path: "no-eval-3fa9c21b.yml",
        signature: await canonicalHash("id: no-eval-3fa9c21b\n"),
      },
    ]);
  });

  it("dereferences a symlinked file, so the bytes signed are the bytes run", async () => {
    const outside = join(cwd, "outside.yml");
    await writeFile(outside, "id: linked\n");
    await rm(join(rules(), "sg", "no-eval-3fa9c21b", "no-eval-3fa9c21b.yml"));
    await symlink(
      outside,
      join(rules(), "sg", "no-eval-3fa9c21b", "no-eval-3fa9c21b.yml")
    );
    const snapshot = await snap(cwd);
    await writeFile(outside, "id: changed after the snapshot\n");
    const report = await reportRules(snapshot);
    expect(report.rules[0]?.files[0]?.signature).toBe(
      await canonicalHash("id: linked\n")
    );
  });

  it("drops a dangling link, which then shows up as a missing file", async () => {
    await symlink(
      join(cwd, "nowhere.yml"),
      join(rules(), "sg", "no-eval-3fa9c21b", "dangling.yml")
    );
    const report = await reportRules(await snap(cwd));
    expect(report.rules[0]?.files.map((file) => file.path)).toEqual([
      "no-eval-3fa9c21b.yml",
    ]);
  });

  it("copies two links that converge on one directory, each in full", async () => {
    const shared = join(cwd, "shared");
    await mkdir(shared);
    await writeFile(join(shared, "helper.yml"), "x: 1\n");
    await symlink(shared, join(rules(), "sg", "no-eval-3fa9c21b", "a"));
    await symlink(shared, join(rules(), "sg", "no-eval-3fa9c21b", "b"));
    const report = await reportRules(await takeSnapshot(cwd));
    expect(report.rules[0]?.files.map((file) => file.path)).toEqual([
      "a/helper.yml",
      "b/helper.yml",
      "no-eval-3fa9c21b.yml",
    ]);
  });

  it("does not follow a link back into a directory it is already inside", async () => {
    await symlink(
      join(rules(), "sg", "no-eval-3fa9c21b"),
      join(rules(), "sg", "no-eval-3fa9c21b", "loop")
    );
    const report = await reportRules(await takeSnapshot(cwd));
    expect(report.rules[0]?.files.map((file) => file.path)).toEqual([
      "no-eval-3fa9c21b.yml",
    ]);
  });

  it("neither copies nor reports operating-system metadata", async () => {
    await writeFile(join(rules(), "sg", "no-eval-3fa9c21b", ".DS_Store"), "x");
    const snapshot = await snap(cwd);
    const report = await reportRules(snapshot);
    expect(report.rules[0]?.files.map((file) => file.path)).toEqual([
      "no-eval-3fa9c21b.yml",
    ]);
    expect(
      existsSync(
        join(
          snapshot.base,
          ".taskless",
          "rules",
          "sg",
          "no-eval-3fa9c21b",
          ".DS_Store"
        )
      )
    ).toBe(false);
  });

  it("reports a nested .tests/ as an ordinary file; only the top-level one is fixtures", async () => {
    const nested = join(rules(), "sg", "no-eval-3fa9c21b", "extra", ".tests");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "a.yml"), "id: a\n");
    const report = await reportRules(await snap(cwd));
    expect(report.rules[0]?.files.map((file) => file.path)).toEqual([
      "extra/.tests/a.yml",
      "no-eval-3fa9c21b.yml",
    ]);
  });

  it("reports an id used by two engines as a duplicate, never as either rule", async () => {
    await mkdir(join(rules(), "vale", "no-eval-3fa9c21b"), { recursive: true });
    await writeFile(
      join(rules(), "vale", "no-eval-3fa9c21b", "no-eval-3fa9c21b.yml"),
      "extends: existence\n"
    );
    const report = await reportRules(await snap(cwd));
    expect(report.rules).toEqual([]);
    expect(report.duplicates).toEqual([
      { ruleId: "no-eval-3fa9c21b", engines: ["sg", "vale"] },
    ]);
  });

  it("excluding a rule removes it from the snapshot only", async () => {
    const snapshot = await snap(cwd);
    await excludeFromSnapshot(snapshot, "sg", "no-eval-3fa9c21b");
    const { rules: reported } = await reportRules(snapshot);
    expect(reported).toEqual([]);
    expect(existsSync(join(rules(), "sg", "no-eval-3fa9c21b"))).toBe(true);
  });

  it("an empty project snapshots to no rules", async () => {
    await rm(rules(), { recursive: true });
    const report = await reportRules(await snap(cwd));
    expect(report).toEqual({ rules: [], duplicates: [], unreadable: [] });
  });
});

function keys(results: readonly CheckResult[]): string[] {
  return results
    .map((result) =>
      JSON.stringify([result.file, result.ruleId, result.range, result.message])
    )
    .toSorted();
}

describe("engines read the snapshot exactly as they read the live tree", () => {
  const fixture = join(
    import.meta.dirname,
    "fixtures",
    "mixed-engines-project"
  );
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "tskl-snapshot-engines-"));
    await cp(fixture, cwd, { recursive: true });
    // Scoped to a SUBDIRECTORY glob: the case that would move if Vale resolved
    // section globs against the config file's location rather than the files
    // it is handed.
    const rule = join(cwd, ".taskless", "rules", "vale", "no-basically");
    await mkdir(rule, { recursive: true });
    await writeFile(
      join(rule, "no-basically.yml"),
      "extends: existence\nmessage: \"Avoid '%s'.\"\nlevel: error\nignorecase: true\ntokens:\n  - basically\n"
    );
    await writeFile(
      join(rule, ".vale.ini"),
      "[docs/**/*.md]\ntskl) rule = no-basically\nno-basically.no-basically = YES\n"
    );
    await mkdir(join(cwd, "docs", "deep"), { recursive: true });
    await writeFile(
      join(cwd, "docs", "deep", "a.md"),
      "This is basically simple. Obviously, simply do it.\n"
    );
    await writeFile(join(cwd, "top.md"), "This is basically fine.\n");
    // No `.run/` entry anywhere: the snapshot's own `.gitignore` has to be what
    // keeps the engines from linting the copied rules as project files.
    execFileSync("git", ["init", "-q"], { cwd });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("finds the same results, with the same subdirectory scoping", async () => {
    const live = await assembleEngineConfigs(cwd);
    const fromLive = await runEngines({
      cwd,
      paths: [],
      astGrepConfigPath: live.sg,
      vale: live.vale,
      runtimeRules: [],
    });

    const snapshot = await snap(cwd);
    const assembled = await assembleEngineConfigs(snapshot.base);
    const fromSnapshot = await runEngines({
      cwd,
      paths: [],
      astGrepConfigPath:
        assembled.sg === undefined
          ? undefined
          : fromProjectRoot(snapshot, assembled.sg),
      vale:
        assembled.vale?.status === "ok"
          ? {
              ...assembled.vale,
              path: fromProjectRoot(snapshot, assembled.vale.path),
            }
          : assembled.vale,
      runtimeRules: [],
    });

    expect(fromSnapshot.failures).toEqual([]);
    expect(keys(fromSnapshot.results)).toEqual(keys(fromLive.results));
    const basically = fromSnapshot.results.filter(
      (result) => result.ruleId === "no-basically"
    );
    expect(basically.map((result) => result.file)).toEqual([
      join("docs", "deep", "a.md"),
    ]);
  });
});
