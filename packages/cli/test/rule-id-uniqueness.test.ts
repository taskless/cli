import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import migration from "../src/filesystem/migrations/0009-unique-rule-ids";
import { writeRuleFile } from "../src/rules/files";
import { verifyOneRule } from "../src/rules/inspect";
import { findRuleIdCollisions } from "../src/rules/id-uniqueness";
import { CLIError } from "../src/util/cli-error";

/**
 * A rule id is a directory name under `.taskless/rules/<engine>/`, and nothing
 * in the id contract makes it unique across the three sibling trees. These
 * cases pin the two places that now say so: `verify`, per rule, and migration
 * `0009`, once per project on upgrade.
 *
 * Every case uses `vale` and `runtime` rules. Both verify from the files alone,
 * so nothing here depends on an engine binary being installed — and the
 * uniqueness check is engine-agnostic by construction, so the pair chosen
 * proves the same thing an `sg`/`vale` pair would.
 */
let cwd: string;

const SCOPED = (id: string): string =>
  `[*.md]\ntskl) rule = ${id}\n${id}.${id} = YES\n`;

async function valeRule(id: string): Promise<string> {
  const directory = join(cwd, ".taskless", "rules", "vale", id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${id}.yml`),
    `extends: existence\nmessage: "Avoid %s"\nlevel: warning\ntokens:\n  - simply\n`,
    "utf8"
  );
  await writeFile(join(directory, ".vale.ini"), SCOPED(id), "utf8");
  return directory;
}

async function runtimeRule(id: string): Promise<string> {
  const directory = join(cwd, ".taskless", "rules", "runtime", id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "check.ts"), "export default () => [];\n");
  return directory;
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-rule-id-"));
  await mkdir(join(cwd, ".taskless", "rules"), { recursive: true });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("verify refuses a rule id held by more than one engine", () => {
  it("fails both rules of a colliding pair, naming both paths", async () => {
    const valePath = await valeRule("no-eval");
    const runtimePath = await runtimeRule("no-eval");

    for (const engine of ["vale", "runtime"] as const) {
      const result = await verifyOneRule(cwd, { engine, ruleId: "no-eval" });
      expect(result.ok).toBe(false);
      const joined = result.errors.join(" ");
      expect(joined).toContain(valePath);
      expect(joined).toContain(runtimePath);
      expect(joined).toContain("is held by 2 engines");
    }
  });

  // The whole reason the check is per rule rather than only project-wide: an
  // author verifying the rule they just wrote is the moment the collision is
  // cheapest to fix, and a pass over the two id lists says nothing then.
  it("catches the collision when a single rule is verified", async () => {
    await valeRule("no-eval");
    await runtimeRule("no-eval");
    await valeRule("no-simply");

    const result = await verifyOneRule(cwd, {
      engine: "vale",
      ruleId: "no-eval",
    });
    expect(result.errors[0]).toContain("does not name one rule");
  });

  it("passes a tree where every id is held by one engine", async () => {
    await valeRule("no-simply");
    await runtimeRule("env-keys-declared");

    const vale = await verifyOneRule(cwd, {
      engine: "vale",
      ruleId: "no-simply",
    });
    expect(vale.ok).toBe(true);
    expect(vale.errors).toEqual([]);
    expect(await findRuleIdCollisions(cwd)).toEqual([]);
  });

  // The collision is not attributed to a published constraint: every entry in
  // RULE_CONSTRAINTS is declared for one engine, and this one is about the
  // project's layout rather than about any engine's rule.
  it("reports the collision without attributing it to a constraint", async () => {
    await valeRule("no-eval");
    await runtimeRule("no-eval");

    const result = await verifyOneRule(cwd, {
      engine: "vale",
      ruleId: "no-eval",
    });
    expect(result.violations).toEqual([]);
  });
});

describe("migration 0009 refuses a colliding project", () => {
  it("throws naming both directories and the rename to perform", async () => {
    const valePath = await valeRule("no-eval");
    const runtimePath = await runtimeRule("no-eval");

    const error = await migration(join(cwd, ".taskless")).then(
      () => {},
      (error_: unknown) => error_
    );
    expect(error).toBeInstanceOf(CLIError);
    const message = (error as CLIError).message;
    expect(message).toContain(valePath);
    expect(message).toContain(runtimePath);
    expect(message).toContain("rule-metadata");
    expect((error as CLIError).code).toBe("RULE_ID_AMBIGUOUS");

    // Detects, never renames: nothing here can tell which rule should keep the
    // id, and the sidecar, the `.tests/` fixtures and the server-side id all
    // reference the old name.
    const valeStats = await stat(valePath);
    const runtimeStats = await stat(runtimePath);
    expect(valeStats.isDirectory()).toBe(true);
    expect(runtimeStats.isDirectory()).toBe(true);
  });

  // The migration runs on `init`, and `check`/`verify` send a stale scaffold
  // to `init`. If the refusal did not say what to do BEFORE re-running `init`,
  // the two messages would form a loop.
  it("tells the user to rename before re-running init", async () => {
    await valeRule("no-eval");
    await runtimeRule("no-eval");

    const error = (await migration(join(cwd, ".taskless")).catch(
      (error_: unknown) => error_
    )) as CLIError;
    expect(error.message).toMatch(/Rename one of those directories before/);
    expect(error.message).toContain("init");
    expect(error.message).toContain("nothing is renamed for you");
  });

  it("is a no-op on a project with no collision, writing nothing", async () => {
    await valeRule("no-simply");
    await runtimeRule("env-keys-declared");
    const before = await snapshot(join(cwd, ".taskless"));

    await expect(migration(join(cwd, ".taskless"))).resolves.toBeUndefined();
    await expect(migration(join(cwd, ".taskless"))).resolves.toBeUndefined();

    expect(await snapshot(join(cwd, ".taskless"))).toEqual(before);
  });

  it("is a no-op on a project with no rules tree at all", async () => {
    await rm(join(cwd, ".taskless", "rules"), { recursive: true });
    await expect(migration(join(cwd, ".taskless"))).resolves.toBeUndefined();
  });
});

describe("writeRuleFile keeps working through a collision", () => {
  // `check`'s repair path calls `writeRuleFile`. A refusal here would brick
  // repair for BOTH colliding rules, which is worse than the silence it would
  // replace, so the write succeeds and only warns.
  it("writes the rule and warns instead of refusing", async () => {
    await valeRule("no-eval");
    const warnings: string[] = [];

    const written = await writeRuleFile(
      cwd,
      {
        id: "no-eval",
        engine: "sg",
        content: {
          id: "no-eval",
          language: "TypeScript",
          severity: "error",
          message: "no eval",
          rule: { pattern: "eval($A)" },
        },
      } as Parameters<typeof writeRuleFile>[1],
      (message) => warnings.push(message)
    );

    expect(await readFile(written, "utf8")).toContain("no-eval");
    expect(warnings.join(" ")).toContain("is held by 2 engines");
  });

  it("does not warn when the id is held by one engine", async () => {
    const warnings: string[] = [];
    await writeRuleFile(
      cwd,
      {
        id: "no-debugger",
        engine: "sg",
        content: {
          id: "no-debugger",
          language: "TypeScript",
          severity: "error",
          message: "no debugger",
          rule: { pattern: "debugger" },
        },
      } as Parameters<typeof writeRuleFile>[1],
      (message) => warnings.push(message)
    );
    expect(warnings).toEqual([]);
  });
});

/** Every file under `directory`, with its size and mtime, for an idempotency check. */
async function snapshot(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const path = join(entry.parentPath, entry.name);
    const stats = await stat(path);
    lines.push(`${path} ${String(stats.size)} ${stats.mtimeMs.toString()}`);
  }
  return lines.toSorted((a, b) => a.localeCompare(b));
}
