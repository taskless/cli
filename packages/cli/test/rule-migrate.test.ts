import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { AST_GREP_VERSION, VALE_VERSION } from "../src/rules/capabilities";
import { validateValeRule } from "../src/schemas/vale-rule";
import {
  applyRuleMigrations,
  pendingRuleMigrations,
  type RuleMigration,
} from "../src/rules/rule-migrate";
import haskellTypeSynonym, {
  renameTypeSynonymKind,
} from "../src/rules/rule-migrations/sg-0-50-0-haskell-type-synonym";
import valeTestsToFixtures, {
  planTestsMigration,
} from "../src/rules/rule-migrations/vale-3-24-0-tests-to-fixtures";

const noop = (
  engine: RuleMigration["engine"],
  engineVersion: string
): RuleMigration => ({
  engine,
  engineVersion,
  summary: `${engine} ${engineVersion}`,
  apply: () => Promise.resolve([]),
});

describe("which rule migrations are pending", () => {
  const migrations = [
    noop("sg", "0.50.0"),
    noop("vale", "3.0.0"),
    noop("sg", "0.40.0"),
    // Above the bundled engine: written ahead of the bump that needs it.
    noop("sg", "999.0.0"),
  ];

  it("runs those the recorded engine has not crossed, oldest first", () => {
    const pending = pendingRuleMigrations(
      { sg: "0.45.3", vale: "2.0.0" },
      migrations
    );
    expect(pending.map((m) => m.summary)).toEqual(["sg 0.50.0", "vale 3.0.0"]);
  });

  it("runs none once the recorded engines are the bundled ones", () => {
    expect(
      pendingRuleMigrations(
        { sg: AST_GREP_VERSION, vale: VALE_VERSION },
        migrations
      )
    ).toEqual([]);
  });

  it("runs every one up to the bundled engine when none was recorded", () => {
    // A rules block with no engines predates the marker, so nothing in it has
    // had a migration applied. Reading absence as current would skip them all.
    expect(
      pendingRuleMigrations(undefined, migrations).map((m) => m.summary)
    ).toEqual(["sg 0.40.0", "sg 0.50.0", "vale 3.0.0"]);
  });

  it("keys each engine on its own recorded version", () => {
    expect(
      pendingRuleMigrations({ sg: AST_GREP_VERSION }, migrations).map(
        (m) => m.summary
      )
    ).toEqual(["vale 3.0.0"]);
  });
});

describe("the Haskell type_synonym rename", () => {
  it.each([
    ["block", "  kind: type_synomym\n", "  kind: type_synonym\n"],
    ["flow", "has: { kind: type_synomym }\n", "has: { kind: type_synonym }\n"],
    ["double-quoted", 'kind: "type_synomym"\n', 'kind: "type_synonym"\n'],
    ["single-quoted", "kind: 'type_synomym'\n", "kind: 'type_synonym'\n"],
    ["list item", "  - kind: type_synomym\n", "  - kind: type_synonym\n"],
  ])("renames a %s kind", (_shape, before, after) => {
    expect(renameTypeSynonymKind(before)).toBe(after);
  });

  it("leaves prose and look-alike kinds alone", () => {
    const source =
      "message: avoid type_synomym here\nkind: type_synomym_x\nkind: type_synomyms\n";
    expect(renameTypeSynonymKind(source)).toBe(source);
  });
});

/** An sg rule naming the old kind, in `language`. */
const haskell = (language: string) =>
  [
    `id: syn`,
    `language: ${language}`,
    "severity: error",
    "message: m",
    "# a comment the rewrite must keep",
    "rule:",
    "  kind: type_synomym",
    "",
  ].join("\n");

describe("applying the Haskell rename to a project", () => {
  let tasklessDirectory: string;
  const sg = () => join(tasklessDirectory, "rules", "sg");

  async function rule(id: string, body: string, tests?: string) {
    await mkdir(join(sg(), id, ".tests"), { recursive: true });
    await writeFile(join(sg(), id, `${id}.yml`), body);
    if (tests !== undefined) {
      await writeFile(join(sg(), id, ".tests", `${id}-test.yml`), tests);
    }
  }
  const read = (id: string) => readFile(join(sg(), id, `${id}.yml`), "utf8");

  beforeEach(async () => {
    tasklessDirectory = join(
      await mkdtemp(join(tmpdir(), "rule-migrate-")),
      ".taskless"
    );
  });

  afterEach(async () => {
    await rm(join(tasklessDirectory, ".."), { recursive: true, force: true });
  });

  it("rewrites a Haskell rule in place and reports it", async () => {
    await rule("syn", haskell("Haskell"));
    const applied = await applyRuleMigrations(tasklessDirectory, {
      sg: "0.45.3",
      vale: VALE_VERSION,
    });
    expect(applied).toEqual([
      {
        engine: "sg",
        engineVersion: "0.50.0",
        summary: haskellTypeSynonym.summary,
        files: [join(".taskless", "rules", "sg", "syn", "syn.yml")],
      },
    ]);
    expect(await read("syn")).toBe(
      haskell("Haskell").replace("type_synomym", "type_synonym")
    );
  });

  it("reads the language the way ast-grep does, alias included", async () => {
    await rule("syn", haskell("hs"));
    await haskellTypeSynonym.apply(sg());
    expect(await read("syn")).toContain("kind: type_synonym");
  });

  it("does not touch a rule in another language", async () => {
    await rule("syn", haskell("TypeScript"));
    expect(await haskellTypeSynonym.apply(sg())).toEqual([]);
    expect(await read("syn")).toBe(haskell("TypeScript"));
  });

  it("never reads fixtures", async () => {
    const fixture = "id: syn\ninvalid:\n  - 'kind: type_synomym'\n";
    await rule("syn", haskell("Haskell"), fixture);
    await haskellTypeSynonym.apply(sg());
    expect(
      await readFile(join(sg(), "syn", ".tests", "syn-test.yml"), "utf8")
    ).toBe(fixture);
  });

  it("writes nothing on a second run", async () => {
    await rule("syn", haskell("Haskell"));
    await haskellTypeSynonym.apply(sg());
    expect(await haskellTypeSynonym.apply(sg())).toEqual([]);
  });

  it("is a no-op on a project with no sg rules", async () => {
    expect(await haskellTypeSynonym.apply(sg())).toEqual([]);
  });

  it("fails, rather than reporting nothing to do, when the tree is unreadable", async () => {
    // A file where the directory should be: ENOTDIR, not ENOENT. Read as
    // "nothing to do", the stamp would record the rename as applied.
    await mkdir(tasklessDirectory, { recursive: true });
    await mkdir(join(tasklessDirectory, "rules"));
    await writeFile(sg(), "");
    await expect(haskellTypeSynonym.apply(sg())).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  });

  it("does not run once the recorded engine has crossed it", async () => {
    await rule("syn", haskell("Haskell"));
    expect(
      await applyRuleMigrations(tasklessDirectory, {
        sg: AST_GREP_VERSION,
        vale: VALE_VERSION,
      })
    ).toEqual([]);
    expect(await read("syn")).toBe(haskell("Haskell"));
  });
});

/** A Vale rule with `tests` spliced in where the caller puts it. */
const valeRule = (tests: string, after = "level: warning\n") =>
  `extends: existence\nmessage: "Avoid '%s'"\n# kept\n${tests}${after}tokens:\n  - simply\n`;

describe("planning the Vale tests: move", () => {
  const without = valeRule("");

  it.each([
    ["an indented list", "tests:\n  - name: a\n    input: x\n    want: ''\n"],
    [
      "a list at the key's own column",
      "tests:\n- name: a\n  input: x\n  want: ''\n",
    ],
    [
      "a list with a blank line inside",
      "tests:\n  - name: a\n\n    input: x\n    want: ''\n",
    ],
  ])("removes %s and keeps every other byte", (_shape, tests) => {
    const source = valeRule(tests);
    const plan = planTestsMigration(source, "r.yml");
    expect(plan).toBeDefined();
    if (plan === undefined) return;
    expect(source.slice(0, plan.blockStart) + source.slice(plan.blockEnd)).toBe(
      without
    );
  });

  it("removes a block that ends the file with no newline", () => {
    const source =
      'extends: existence\nmessage: "x"\ntests:\n  - name: a\n    want: ""';
    const plan = planTestsMigration(source, "r.yml");
    expect(plan).toBeDefined();
    if (plan === undefined) return;
    expect(source.slice(0, plan.blockStart)).toBe(
      'extends: existence\nmessage: "x"\n'
    );
    expect(plan.blockEnd).toBe(source.length);
  });

  it.each([
    ["want with text", "want: '1:1:r.r:Avoid'", "fail"],
    ["an empty want", "want: ''", "pass"],
    ["an empty block want", "want: |\n", "pass"],
    ["contains", "contains: r.r", "fail"],
    ["a contains list", "contains:\n      - Avoid", "fail"],
    ["only absent", "absent: r.r", "pass"],
    ["want beside contains", "want: ''\n    contains: x", "pass"],
  ])("files a case with %s under %s", (_shape, assertion, bucket) => {
    const plan = planTestsMigration(
      valeRule(`tests:\n  - name: a\n    input: x\n    ${assertion}\n`),
      "r.yml"
    );
    expect(plan?.cases[0]?.bucket).toBe(bucket);
  });

  it("names the fixture for the case and reads its format as Vale does", () => {
    const plan = planTestsMigration(
      valeRule(
        "tests:\n  - name: Flags a hedge!\n    input: x\n    format: .rst\n    want: ''\n" +
          "  - name: b\n    input: y\n    format: txt\n    want: ''\n" +
          "  - input: z\n    want: ''\n"
      ),
      "r.yml"
    );
    expect(plan?.cases.map((c) => `${c.name}.${c.extension}`)).toEqual([
      "flags-a-hedge.rst",
      "b.txt",
      "case-3.md",
    ]);
  });

  it.each([
    ["reads through a view", "view: Docs\n    want: ''"],
    ["names another rule file", "rule: ../other/other.yml\n    want: ''"],
    ["asserts nothing", "about: no assertion"],
  ])("leaves a rule alone when a case %s", (_shape, extra) => {
    expect(
      planTestsMigration(
        valeRule(`tests:\n  - name: a\n    input: x\n    ${extra}\n`),
        "r.yml"
      )
    ).toBeUndefined();
  });

  it("accepts a case that names its own rule file", () => {
    expect(
      planTestsMigration(
        valeRule("tests:\n  - name: a\n    rule: r.yml\n    want: ''\n"),
        "r.yml"
      )
    ).toBeDefined();
  });

  it.each([
    ["no tests key", valeRule("")],
    ["no extends", "message: x\ntests:\n  - name: a\n    want: ''\n"],
    [
      "two documents",
      `${valeRule("tests:\n  - name: a\n    want: ''\n")}---\nextends: x\n`,
    ],
    ["a tests key that is not a list", valeRule("tests: fixture.md\n")],
  ])("is not a rule to move with %s", (_shape, source) => {
    expect(planTestsMigration(source, "r.yml")).toBeUndefined();
  });
});

describe("applying the Vale tests: move to a project", () => {
  let tasklessDirectory: string;
  const vale = () => join(tasklessDirectory, "rules", "vale");
  const path = (...segments: string[]) => join(vale(), ...segments);

  const source = valeRule(
    "tests:\n  - name: flags it\n    input: Just simply do it.\n    contains: Avoid\n" +
      "  - name: quiet\n    input: |\n      Just do it.\n    want: ''\n"
  );

  async function rule(id: string, body: string) {
    await mkdir(path(id), { recursive: true });
    await writeFile(path(id, `${id}.yml`), body);
  }

  beforeEach(async () => {
    tasklessDirectory = join(
      await mkdtemp(join(tmpdir(), "rule-migrate-vale-")),
      ".taskless"
    );
  });

  afterEach(async () => {
    await rm(join(tasklessDirectory, ".."), { recursive: true, force: true });
  });

  it("writes each case as a fixture, removes the key, and reports both", async () => {
    await rule("no-simply", source);
    const written = await valeTestsToFixtures.apply(vale());
    expect(written).toEqual([
      join("no-simply", ".tests", "fail", "flags-it.md"),
      join("no-simply", ".tests", "pass", "quiet.md"),
      join("no-simply", "no-simply.yml"),
    ]);
    expect(
      await readFile(path("no-simply", ".tests", "fail", "flags-it.md"), "utf8")
    ).toBe("Just simply do it.");
    expect(
      await readFile(path("no-simply", ".tests", "pass", "quiet.md"), "utf8")
    ).toBe("Just do it.\n");
    const migrated = await readFile(path("no-simply", "no-simply.yml"), "utf8");
    expect(migrated).toBe(valeRule(""));
    // The point of the move: the rule validates again.
    expect(validateValeRule("no-simply", parseYaml(migrated)).valid).toBe(true);
  });

  it("writes nothing on a second run", async () => {
    await rule("no-simply", source);
    await valeTestsToFixtures.apply(vale());
    expect(await valeTestsToFixtures.apply(vale())).toEqual([]);
  });

  it("finishes a run interrupted after the fixtures, without duplicating them", async () => {
    await rule("no-simply", source);
    await mkdir(path("no-simply", ".tests", "fail"), { recursive: true });
    await writeFile(
      path("no-simply", ".tests", "fail", "flags-it.md"),
      "Just simply do it."
    );
    expect(await valeTestsToFixtures.apply(vale())).toEqual([
      join("no-simply", ".tests", "pass", "quiet.md"),
      join("no-simply", "no-simply.yml"),
    ]);
  });

  it("never overwrites a different fixture of the same name", async () => {
    await rule("no-simply", source);
    await mkdir(path("no-simply", ".tests", "fail"), { recursive: true });
    await writeFile(path("no-simply", ".tests", "fail", "flags-it.md"), "mine");
    const written = await valeTestsToFixtures.apply(vale());
    expect(written).toContain(
      join("no-simply", ".tests", "fail", "flags-it-2.md")
    );
    expect(
      await readFile(path("no-simply", ".tests", "fail", "flags-it.md"), "utf8")
    ).toBe("mine");
  });

  it("leaves a rule it cannot place untouched", async () => {
    const body = valeRule(
      "tests:\n  - name: a\n    view: Docs\n    want: ''\n"
    );
    await rule("viewed", body);
    expect(await valeTestsToFixtures.apply(vale())).toEqual([]);
    expect(await readFile(path("viewed", "viewed.yml"), "utf8")).toBe(body);
  });

  it("is a no-op on a project with no Vale rules", async () => {
    expect(await valeTestsToFixtures.apply(vale())).toEqual([]);
  });

  it("fails, rather than reporting nothing to do, when the tree is unreadable", async () => {
    await mkdir(join(tasklessDirectory, "rules"), { recursive: true });
    await writeFile(vale(), "not a directory");
    await expect(valeTestsToFixtures.apply(vale())).rejects.toThrow();
  });

  it("runs for rules recorded below 3.24.0 and not after", async () => {
    await rule("no-simply", source);
    expect(
      await applyRuleMigrations(tasklessDirectory, {
        sg: AST_GREP_VERSION,
        vale: VALE_VERSION,
      })
    ).toEqual([]);
    const applied = await applyRuleMigrations(tasklessDirectory, {
      sg: AST_GREP_VERSION,
      vale: "3.23.0",
    });
    expect(applied.map((m) => m.engineVersion)).toEqual(["3.24.0"]);
    expect(applied[0]?.files).toContain(
      join(".taskless", "rules", "vale", "no-simply", "no-simply.yml")
    );
  });
});
