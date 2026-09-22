import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import migration, {
  retargetValeConfig,
} from "../src/filesystem/migrations/0009-unique-rule-ids";
import { writeRuleFile } from "../src/rules/files";
import { verifyOneRule } from "../src/rules/inspect";
import { findRuleIdCollisions } from "../src/rules/id-uniqueness";
import type { EngineName } from "../src/rules/layout";

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

/** `.taskless/rules/<engine>/<id>`, for asserting on where a rule landed. */
function rulePath(engine: EngineName, id: string): string {
  return join(cwd, ".taskless", "rules", engine, id);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** An sg rule, with the `id:` field and one fixture the rename has to follow. */
async function sgRule(id: string): Promise<string> {
  const directory = join(cwd, ".taskless", "rules", "sg", id);
  await mkdir(join(directory, ".tests"), { recursive: true });
  await writeFile(
    join(directory, `${id}.yml`),
    `id: ${id}\nlanguage: TypeScript\nseverity: error\nmessage: no eval\nrule:\n  pattern: eval($A)\n`,
    "utf8"
  );
  await writeFile(
    join(directory, ".tests", `${id}-20260101-test.yml`),
    `id: ${id}\nvalid:\n  - const a = 1;\ninvalid:\n  - eval(x);\n`,
    "utf8"
  );
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

describe("migration 0009 renames a colliding project", () => {
  // Symmetric: neither engine keeps the bare id, because any precedence rule
  // would be arbitrary and would leave a user working out which of their two
  // rules silently kept the name.
  it("renames every colliding copy to <id>-<engine>", async () => {
    await sgRule("no-eval");
    await valeRule("no-eval");

    await migration(join(cwd, ".taskless"));

    expect(await exists(rulePath("sg", "no-eval"))).toBe(false);
    expect(await exists(rulePath("vale", "no-eval"))).toBe(false);
    expect(await exists(rulePath("sg", "no-eval-sg"))).toBe(true);
    expect(await exists(rulePath("vale", "no-eval-vale"))).toBe(true);
  });

  it("moves an sg rule's file, its id: field, and its fixtures", async () => {
    await sgRule("no-eval");
    await valeRule("no-eval");

    await migration(join(cwd, ".taskless"));

    const directory = rulePath("sg", "no-eval-sg");
    expect(await readFile(join(directory, "no-eval-sg.yml"), "utf8")).toContain(
      "id: no-eval-sg"
    );
    // BOTH halves matter: the filename prefix is how `discoverRuleTestFiles`
    // claims a fixture for a rule, and the `id:` inside is what ast-grep
    // attributes cases by. Miss either and the rule reads as untested.
    const fixture = join(directory, ".tests", "no-eval-sg-20260101-test.yml");
    expect(await exists(fixture)).toBe(true);
    expect(await readFile(fixture, "utf8")).toContain("id: no-eval-sg");
  });

  it("moves a Vale rule's style file and both segments of its config", async () => {
    await sgRule("no-eval");
    await valeRule("no-eval");

    await migration(join(cwd, ".taskless"));

    const directory = rulePath("vale", "no-eval-vale");
    expect(await exists(join(directory, "no-eval-vale.yml"))).toBe(true);
    const config = await readFile(join(directory, ".vale.ini"), "utf8");
    expect(config).toContain("tskl) rule = no-eval-vale");
    // The style directory AND the style file basename both moved, because
    // StylesPath points at rules/vale.
    expect(config).toContain("no-eval-vale.no-eval-vale = YES");
    expect(config).not.toContain("no-eval.no-eval");
  });

  it("renames a runtime rule by directory alone", async () => {
    await runtimeRule("no-eval");
    await valeRule("no-eval");

    await migration(join(cwd, ".taskless"));

    const directory = rulePath("runtime", "no-eval-runtime");
    expect(await exists(join(directory, "check.ts"))).toBe(true);
  });

  // Never clobbers. `<id>-<engine>` taken means the next free ascending
  // suffix, and free means held by NO engine, so clearing one collision
  // cannot create another.
  it("takes the next free suffix when <id>-<engine> is taken", async () => {
    await sgRule("no-eval");
    await valeRule("no-eval");
    await sgRule("no-eval-sg");

    await migration(join(cwd, ".taskless"));

    // The pre-existing `no-eval-sg` is untouched and keeps its own id.
    expect(
      await readFile(
        join(rulePath("sg", "no-eval-sg"), "no-eval-sg.yml"),
        "utf8"
      )
    ).toContain("id: no-eval-sg");
    expect(await exists(rulePath("sg", "no-eval-sg-2"))).toBe(true);
    expect(
      await readFile(
        join(rulePath("sg", "no-eval-sg-2"), "no-eval-sg-2.yml"),
        "utf8"
      )
    ).toContain("id: no-eval-sg-2");
  });

  it("leaves the metadata sidecar in place rather than guessing an owner", async () => {
    await sgRule("no-eval");
    await valeRule("no-eval");
    const sidecar = join(cwd, ".taskless", "rule-metadata", "no-eval.yml");
    await mkdir(join(cwd, ".taskless", "rule-metadata"), { recursive: true });
    await writeFile(sidecar, "title: something\n", "utf8");

    await migration(join(cwd, ".taskless"));

    expect(await readFile(sidecar, "utf8")).toBe("title: something\n");
  });

  // The rewritten Vale config has to still describe a rule Vale would enable:
  // both segments of `<id>.<id>` moved, and a half-renamed assignment verifies
  // as a rule that is present and off.
  it("leaves the renamed Vale rule verifying clean", async () => {
    await sgRule("no-eval");
    await valeRule("no-eval");

    await migration(join(cwd, ".taskless"));

    const result = await verifyOneRule(cwd, {
      engine: "vale",
      ruleId: "no-eval-vale",
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("leaves no collision behind", async () => {
    await sgRule("no-eval");
    await valeRule("no-eval");
    await runtimeRule("no-eval");

    await migration(join(cwd, ".taskless"));

    expect(await findRuleIdCollisions(cwd)).toEqual([]);
  });

  it("is a no-op on a project with no collision, writing nothing", async () => {
    await valeRule("no-simply");
    await runtimeRule("env-keys-declared");
    const before = await snapshot(join(cwd, ".taskless"));

    await expect(migration(join(cwd, ".taskless"))).resolves.toBeUndefined();
    await expect(migration(join(cwd, ".taskless"))).resolves.toBeUndefined();

    expect(await snapshot(join(cwd, ".taskless"))).toEqual(before);
  });

  it("is idempotent: a second run after a rename changes nothing", async () => {
    await sgRule("no-eval");
    await valeRule("no-eval");
    await migration(join(cwd, ".taskless"));
    const after = await snapshot(join(cwd, ".taskless"));

    await migration(join(cwd, ".taskless"));

    expect(await snapshot(join(cwd, ".taskless"))).toEqual(after);
  });

  it("is a no-op on a project with no rules tree at all", async () => {
    await rm(join(cwd, ".taskless", "rules"), { recursive: true });
    await expect(migration(join(cwd, ".taskless"))).resolves.toBeUndefined();
  });
});

describe("retargetValeConfig", () => {
  it("moves the breadcrumb and both assignment segments, leaving other bytes", () => {
    const source =
      "# no-eval is mentioned in this comment\n" +
      "[*.md]\n" +
      "tskl) rule = no-eval\n" +
      "no-eval.no-eval = YES\n" +
      "\n" +
      "[CHANGELOG.md]\n" +
      "tskl) rule = no-eval\n" +
      "no-eval.no-eval = NO\n";

    expect(retargetValeConfig(source, "no-eval", "no-eval-vale")).toBe(
      "# no-eval is mentioned in this comment\n" +
        "[*.md]\n" +
        "tskl) rule = no-eval-vale\n" +
        "no-eval-vale.no-eval-vale = YES\n" +
        "\n" +
        "[CHANGELOG.md]\n" +
        "tskl) rule = no-eval-vale\n" +
        "no-eval-vale.no-eval-vale = NO\n"
    );
  });

  it("leaves a config naming a different rule alone", () => {
    const source = "[*.md]\ntskl) rule = other\nother.other = YES\n";
    expect(retargetValeConfig(source, "no-eval", "no-eval-vale")).toBe(source);
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
