import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/**
 * The `rename` the migration must die on, named by the basename of its source,
 * its destination, or both. `undefined` lets a run finish.
 *
 * A crash is injected at a NAMED rename rather than at the Nth call, so a case
 * says which step it interrupts and stays readable when the number of writes
 * changes. Basenames rather than whole paths because the pre-fix ordering
 * renamed the directory first, so the same step happens under a different
 * parent there — matching the whole path would make these cases silently stop
 * injecting anything against the code they exist to fail against.
 *
 * BOTH ENDS ARE MATCHABLE BECAUSE THE DESTINATION ALONE IS AMBIGUOUS. Putting
 * `<to>.yml` in place and committing a rewrite OF `<to>.yml` are two renames
 * with the same destination, and the first always runs first — so a
 * destination-only harness can never stop between them, which is exactly the
 * state `renameRuleFile`'s resume branch exists to repair. Naming the source
 * separates them: the commit's source is the `.tskl-0009.tmp` sibling, the file
 * rename's source is `<from>.yml`.
 */
let crashAtRename: { from?: string; to?: string } | undefined;

/**
 * The suffix {@link writeFileAtomically} gives its temporary sibling.
 *
 * Duplicated from the migration on purpose rather than exported for the test:
 * it is an implementation detail the migration is free to change, and a case
 * naming it is asserting on the step it means to interrupt. If this ever stops
 * matching, the affected cases fail by never injecting a crash, which is loud.
 */
const ATOMIC_WRITE_SUFFIX = ".tskl-0009.tmp";

vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
  return {
    ...actual,
    rename: async (
      from: Parameters<typeof actual.rename>[0],
      to: Parameters<typeof actual.rename>[1]
    ) => {
      const wanted = crashAtRename;
      if (
        wanted !== undefined &&
        (wanted.from === undefined ||
          wanted.from === basename(from.toString())) &&
        (wanted.to === undefined || wanted.to === basename(to.toString()))
      ) {
        throw new Error(
          `simulated crash renaming ${from.toString()} -> ${to.toString()}`
        );
      }
      return actual.rename(from, to);
    },
  };
});

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
  crashAtRename = undefined;
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
  // Symmetric between the engines that move: neither `sg` nor `vale` keeps the
  // bare id, because any precedence rule between them would be arbitrary and
  // would leave a user working out which of their two rules kept the name.
  it("renames both sg and vale copies to <id>-<engine>", async () => {
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

  // Runtime rules are the signed tier. Leaving them alone keeps the migration
  // clear of that machinery entirely — and costs nothing, because within one
  // engine the filesystem already guarantees one directory per id, so moving
  // the other copy is enough to resolve the collision.
  it("never renames a runtime rule, moving only the sg copy", async () => {
    await sgRule("no-eval");
    const runtimeDirectory = await runtimeRule("no-eval");
    const before = await snapshot(runtimeDirectory);

    await migration(join(cwd, ".taskless"));

    // Byte-identical: same paths, same sizes, same mtimes.
    expect(await snapshot(runtimeDirectory)).toEqual(before);
    expect(await exists(rulePath("runtime", "no-eval"))).toBe(true);
    expect(await exists(rulePath("runtime", "no-eval-runtime"))).toBe(false);
    expect(await exists(rulePath("sg", "no-eval"))).toBe(false);
    expect(await exists(rulePath("sg", "no-eval-sg"))).toBe(true);
    expect(await findRuleIdCollisions(cwd)).toEqual([]);
  });

  it("never renames a runtime rule when Vale is the other holder", async () => {
    await valeRule("no-eval");
    await runtimeRule("no-eval");

    await migration(join(cwd, ".taskless"));

    expect(await exists(rulePath("runtime", "no-eval"))).toBe(true);
    expect(await exists(rulePath("vale", "no-eval-vale"))).toBe(true);
    const verified = await verifyOneRule(cwd, {
      engine: "vale",
      ruleId: "no-eval-vale",
    });
    expect(verified.ok).toBe(true);
    expect(await findRuleIdCollisions(cwd)).toEqual([]);
  });

  it("moves sg and vale and leaves runtime alone when all three collide", async () => {
    await sgRule("no-eval");
    await valeRule("no-eval");
    const runtimeDirectory = await runtimeRule("no-eval");
    const before = await snapshot(runtimeDirectory);

    await migration(join(cwd, ".taskless"));

    expect(await exists(rulePath("sg", "no-eval-sg"))).toBe(true);
    expect(await exists(rulePath("vale", "no-eval-vale"))).toBe(true);
    expect(await exists(rulePath("runtime", "no-eval"))).toBe(true);
    expect(await snapshot(runtimeDirectory)).toEqual(before);
    expect(await findRuleIdCollisions(cwd)).toEqual([]);

    // Every surviving rule still verifies. The runtime one keeps the bare id
    // and is no longer in collision with anything.
    for (const rule of [
      { engine: "vale", ruleId: "no-eval-vale" },
      { engine: "runtime", ruleId: "no-eval" },
    ] as const) {
      const result = await verifyOneRule(cwd, rule);
      expect(
        result.errors.filter((error) => error.includes("is held by")),
        `${rule.engine}/${rule.ruleId}`
      ).toEqual([]);
    }
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

  // THE CENTREPIECE. A run that dies part-way must leave a tree the next run
  // repairs. The first two crash points are unrecoverable against the previous
  // ordering, which renamed the rule DIRECTORY first: that cleared the
  // collision while the files inside still carried the old id, so the next run
  // returned at the `collisions.length === 0` gate and nothing ever fixed it.
  // Now the directory rename is the last step and therefore the commit point,
  // so an interrupted rule still collides and is picked up again.
  it.each([
    ["the sg rule file rename", { from: "no-eval.yml", to: "no-eval-sg.yml" }],
    [
      "the sg rule file's id: commit",
      { from: `no-eval-sg.yml${ATOMIC_WRITE_SUFFIX}` },
    ],
    [
      "the sg fixture rename",
      { from: "no-eval-20260101-test.yml", to: "no-eval-sg-20260101-test.yml" },
    ],
    [
      "the sg fixture's id: commit",
      { from: `no-eval-sg-20260101-test.yml${ATOMIC_WRITE_SUFFIX}` },
    ],
    ["the sg directory commit", { to: "no-eval-sg" }],
  ])(
    "resumes to a correct end state after crashing at %s",
    async (_step, target) => {
      await sgRule("no-eval");
      await valeRule("no-eval");

      crashAtRename = target;
      await expect(migration(join(cwd, ".taskless"))).rejects.toThrow(
        "simulated crash"
      );
      crashAtRename = undefined;

      // The interrupted rule still holds the colliding id. That is the whole
      // reason the next run looks at it again.
      expect(await findRuleIdCollisions(cwd)).toHaveLength(1);

      await migration(join(cwd, ".taskless"));

      expect(await findRuleIdCollisions(cwd)).toEqual([]);
      const directory = rulePath("sg", "no-eval-sg");
      expect(await exists(rulePath("sg", "no-eval"))).toBe(false);
      expect(
        await readFile(join(directory, "no-eval-sg.yml"), "utf8")
      ).toContain("id: no-eval-sg");
      // Directory, fixture filename and the `id:` inside it all agree, which
      // is the state `verify` demands and a half-migrated tree never reaches.
      expect(await readdir(join(directory, ".tests"))).toEqual([
        "no-eval-sg-20260101-test.yml",
      ]);
      expect(
        await readFile(
          join(directory, ".tests", "no-eval-sg-20260101-test.yml"),
          "utf8"
        )
      ).toContain("id: no-eval-sg");
      // The vale half never started, so the resuming run renames it too.
      const valeDirectory = rulePath("vale", "no-eval-vale");
      expect(
        await readFile(join(valeDirectory, ".vale.ini"), "utf8")
      ).toContain("no-eval-vale.no-eval-vale = YES");
      const verified = await verifyOneRule(cwd, {
        engine: "vale",
        ruleId: "no-eval-vale",
      });
      expect(verified.ok).toBe(true);
    }
  );

  // The same window, built by hand instead of by crashing into it. The harness
  // proves the migration REACHES this state; this proves the repair works on
  // one that arrived any other way — a run killed by SIGKILL, a container
  // evicted mid-write — with no dependence on the temporary file's name.
  it("finishes a rename left between the file move and its id: field", async () => {
    const directory = join(cwd, ".taskless", "rules", "sg", "no-eval");
    await mkdir(join(directory, ".tests"), { recursive: true });
    // Renamed, `id:` not yet rewritten: what an interrupted run leaves. The
    // old early return read a missing `no-eval.yml` as "no rule file" and left
    // both stale ids behind.
    await writeFile(
      join(directory, "no-eval-sg.yml"),
      `id: no-eval\nlanguage: TypeScript\nseverity: error\nmessage: no eval\nrule:\n  pattern: eval($A)\n`,
      "utf8"
    );
    await writeFile(
      join(directory, ".tests", "no-eval-sg-20260101-test.yml"),
      `id: no-eval\nvalid:\n  - const a = 1;\n`,
      "utf8"
    );
    await valeRule("no-eval");

    await migration(join(cwd, ".taskless"));

    const moved = rulePath("sg", "no-eval-sg");
    expect(await exists(join(moved, "no-eval.yml"))).toBe(false);
    expect(await readFile(join(moved, "no-eval-sg.yml"), "utf8")).toContain(
      "id: no-eval-sg"
    );
    expect(
      await readFile(
        join(moved, ".tests", "no-eval-sg-20260101-test.yml"),
        "utf8"
      )
    ).toContain("id: no-eval-sg");
    expect(await findRuleIdCollisions(cwd)).toEqual([]);
  });

  // The output of the fixture rename used to match its own input predicate, so
  // a fixture a human had named `<id>-sg-…` BEFORE this ever ran came back out
  // double-suffixed on the very first run. It is already at the target prefix,
  // so it is left where it is and only its `id:` follows.
  it("does not double-suffix a fixture already named <id>-sg-...", async () => {
    await sgRule("no-eval");
    await valeRule("no-eval");
    await writeFile(
      join(rulePath("sg", "no-eval"), ".tests", "no-eval-sg-basic-test.yml"),
      `id: no-eval\nvalid:\n  - const a = 1;\n`,
      "utf8"
    );

    await migration(join(cwd, ".taskless"));

    const tests = await readdir(join(rulePath("sg", "no-eval-sg"), ".tests"));
    expect(tests.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "no-eval-sg-20260101-test.yml",
      "no-eval-sg-basic-test.yml",
    ]);
    // The `id:` still has to follow, or ast-grep attributes no case to it and
    // the rule reads as having shipped none.
    expect(
      await readFile(
        join(
          rulePath("sg", "no-eval-sg"),
          ".tests",
          "no-eval-sg-basic-test.yml"
        ),
        "utf8"
      )
    ).toContain("id: no-eval-sg");
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
