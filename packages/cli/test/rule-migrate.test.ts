import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AST_GREP_VERSION, VALE_VERSION } from "../src/rules/capabilities";
import {
  applyRuleMigrations,
  pendingRuleMigrations,
  type RuleMigration,
} from "../src/rules/rule-migrate";
import haskellTypeSynonym, {
  renameTypeSynonymKind,
} from "../src/rules/rule-migrations/sg-0-50-0-haskell-type-synonym";

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

  it("does not run once the recorded engine has crossed it", async () => {
    await rule("syn", haskell("Haskell"));
    expect(
      await applyRuleMigrations(tasklessDirectory, { sg: AST_GREP_VERSION })
    ).toEqual([]);
    expect(await read("syn")).toBe(haskell("Haskell"));
  });
});
