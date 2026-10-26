import { describe, expect, it } from "vitest";

import {
  convertLegacyFileSet,
  convertSgTestFile,
  convertValeDocument,
  deriveFixturePath,
  valeFixtureScope,
} from "../src/rules/fixture-convert";

/**
 * The converter shared by migration 12 and delivery. Pure, so every case here
 * is content in and content out, with no filesystem.
 *
 * The directory names are passed as literals rather than read from the layout
 * table: the converter takes both as arguments, and the expected paths below
 * spell them out, so the two must agree in this file whatever the table says.
 */
const TESTS = "tests";
const LEGACY = ".tests";

const scope = (include: string[], exclude: string[] = []) => ({
  include,
  exclude,
});

describe("deriveFixturePath", () => {
  it("puts a file at the case root when the scope has no globs", () => {
    expect(deriveFixturePath(scope([]), "fail-01", "ts")).toBe("fail-01.ts");
  });

  it("names the file for the case under a bare extension glob", () => {
    expect(deriveFixturePath(scope(["*.ts"]), "fail-01", "ts")).toBe(
      "fail-01.ts"
    );
  });

  it("keeps the directories a glob names, hidden ones included", () => {
    // The scenario the spec names: a workflow rule's fixture has to sit where
    // the rule looks, or it is a quiet `fail/` case for no reason.
    expect(
      deriveFixturePath(scope([".github/workflows/*.yml"]), "fail-01", "yml")
    ).toBe(".github/workflows/fail-01.yml");
  });

  it("collapses a globstar to nothing", () => {
    expect(deriveFixturePath(scope(["**/src/**/*.ts"]), "pass-01", "ts")).toBe(
      "src/pass-01.ts"
    );
  });

  it("takes the brace alternative ending in the snippet's extension", () => {
    expect(deriveFixturePath(scope(["*.{ts,tsx}"]), "fail-01", "ts")).toBe(
      "fail-01.ts"
    );
    expect(deriveFixturePath(scope(["*.{ts,tsx}"]), "fail-01", "tsx")).toBe(
      "fail-01.tsx"
    );
  });

  it("puts a file beneath a trailing /**", () => {
    expect(deriveFixturePath(scope(["src/**"]), "fail-01", "ts")).toBe(
      "src/fail-01.ts"
    );
  });

  it("takes the glob that keeps the file's extension over an earlier one", () => {
    expect(deriveFixturePath(scope(["*.md", "*.txt"]), "hedges", "txt")).toBe(
      "hedges.txt"
    );
  });

  it("never changes the file's extension to fit a glob", () => {
    // Both engines read a file by its extension: a .txt document under
    // [*.md] would be linted as Markdown, a TypeScript snippet under lib/*.js
    // parsed as JavaScript.
    expect(deriveFixturePath(scope(["*.md"]), "a", "txt")).toBeUndefined();
    expect(
      deriveFixturePath(
        scope(["src/**/*.ts", "lib/*.js"], ["src/**"]),
        "f",
        "ts"
      )
    ).toBeUndefined();
  });

  it("gives a wildcard-only last segment the file's extension", () => {
    expect(deriveFixturePath(scope(["*"]), "a", "md")).toBe("a.md");
    expect(deriveFixturePath(scope(["src/*"]), "a.b", "ts")).toBe("src/a.b.ts");
  });

  it("fills a negated character class with a character it admits", () => {
    expect(deriveFixturePath(scope(["src/[!_]*.ts"]), "f", "ts")).toBe(
      "src/xf.ts"
    );
  });

  it("returns undefined when an ignore excludes every candidate", () => {
    expect(
      deriveFixturePath(scope(["src/**/*.ts"], ["src/**"]), "fail-01", "ts")
    ).toBeUndefined();
  });

  it("falls through to a later glob when an ignore excludes the first", () => {
    expect(
      deriveFixturePath(scope(["src/**/*.ts", "*.ts"], ["src/**"]), "f", "ts")
    ).toBe("f.ts");
  });
});

/** An ast-grep rule file, with `extra` appended for scope keys. */
const rule = (extra = "") =>
  `id: no-eval\nlanguage: TypeScript\nrule:\n  pattern: eval($A)\n${extra}`;

describe("convertSgTestFile", () => {
  const tests =
    "id: no-eval\nvalid:\n  - JSON.parse(x)\n  - const a = 1;\ninvalid:\n  - eval(x)\n";

  it("leaves a test file with a YAML syntax error unconverted", () => {
    // `parseDocument` collects errors rather than throwing, so without the
    // check a half-parsed `invalid:` list became a case holding its debris.
    const conversion = convertSgTestFile(
      rule(),
      "broken-test.yml",
      "id: no-eval\ninvalid: [unterminated\n",
      TESTS
    );
    expect(conversion.files).toEqual([]);
    expect(conversion.unconverted).toEqual([
      "broken-test.yml: the rule or the test file is not valid YAML",
    ]);
  });

  it("leaves a test file that is a YAML list unconverted", () => {
    // A list passes a bare object check and would convert to no cases, after
    // which the migration deletes the source.
    const conversion = convertSgTestFile(
      rule(),
      "list-test.yml",
      "- eval(x)\n",
      TESTS
    );
    expect(conversion.files).toEqual([]);
    expect(conversion.unconverted).toEqual([
      "list-test.yml: the test file is not a YAML mapping",
    ]);
  });

  it("writes one case per snippet, named by bucket and ordinal", () => {
    const conversion = convertSgTestFile(
      rule(),
      "no-eval-test.yml",
      tests,
      TESTS
    );
    expect(conversion.unconverted).toEqual([]);
    expect(conversion.files).toEqual([
      { path: "tests/pass/pass-01/pass-01.ts", content: "JSON.parse(x)\n" },
      { path: "tests/pass/pass-02/pass-02.ts", content: "const a = 1;\n" },
      { path: "tests/fail/fail-01/fail-01.ts", content: "eval(x)\n" },
    ]);
  });

  it("continues ordinals past the cases another test file claimed", () => {
    // A rule improved twice owns two dated test files, each numbering from
    // one. Without the shared set, the second file's fail-01 overwrote the
    // first's and the migration deleted its source.
    const claimed = new Set<string>();
    const first = convertSgTestFile(
      rule(),
      "no-eval-20260101-test.yml",
      "invalid:\n  - eval(a)\n",
      TESTS,
      claimed
    );
    const second = convertSgTestFile(
      rule(),
      "no-eval-20260301-test.yml",
      "valid:\n  - ok()\ninvalid:\n  - eval(b)\n",
      TESTS,
      claimed
    );
    expect(first.files.map((file) => file.path)).toEqual([
      "tests/fail/fail-01/fail-01.ts",
    ]);
    expect(second.files.map((file) => file.path)).toEqual([
      "tests/pass/pass-01/pass-01.ts",
      "tests/fail/fail-02/fail-02.ts",
    ]);
  });

  it("claims nothing for a test file it refuses", () => {
    const claimed = new Set<string>();
    convertSgTestFile(
      rule(),
      "half-test.yml",
      "valid:\n  - ok()\ninvalid:\n  - 3\n",
      TESTS,
      claimed
    );
    expect(claimed).toEqual(new Set());
  });

  it("places each snippet where the rule's files: looks", () => {
    const conversion = convertSgTestFile(
      rule('files:\n  - "src/**/*.ts"\n'),
      "no-eval-test.yml",
      "invalid:\n  - eval(x)\n",
      TESTS
    );
    expect(conversion.files.map((file) => file.path)).toEqual([
      "tests/fail/fail-01/src/fail-01.ts",
    ]);
  });

  it("reads ast-grep's object form of a files: entry", () => {
    const conversion = convertSgTestFile(
      rule("files:\n  - glob: lib/*.ts\n"),
      "t.yml",
      "invalid:\n  - eval(x)\n",
      TESTS
    );
    expect(conversion.files[0]?.path).toBe("tests/fail/fail-01/lib/fail-01.ts");
  });

  it("takes the extension from the language, any spelling ast-grep resolves", () => {
    const conversion = convertSgTestFile(
      "id: r\nlanguage: python\nrule:\n  pattern: eval($A)\n",
      "t.yml",
      "invalid:\n  - eval(x)\n",
      TESTS
    );
    expect(conversion.files[0]?.path).toBe("tests/fail/fail-01/fail-01.py");
  });

  it.each([
    [
      "a language with no extension",
      "id: r\nlanguage: Klingon\nrule:\n  pattern: x\n",
      "invalid:\n  - x\n",
      "has no file extension",
    ],
    [
      "a test file that is not a mapping",
      rule(),
      "eval(x)\n",
      "not a YAML mapping",
    ],
    [
      "an invalid: key that is not a list",
      rule(),
      "invalid: eval(x)\n",
      "is not a list",
    ],
    [
      "a scope no path can be derived for",
      rule('files:\n  - "src/**/*.ts"\nignores:\n  - "src/**"\n'),
      "invalid:\n  - eval(x)\n",
      "no path could be derived",
    ],
  ])(
    "converts nothing, and says why, for %s",
    (_, ruleSource, test, reason) => {
      const conversion = convertSgTestFile(ruleSource, "t.yml", test, TESTS);
      expect(conversion.files).toEqual([]);
      expect(conversion.unconverted).toHaveLength(1);
      expect(conversion.unconverted[0]).toContain("t.yml");
      expect(conversion.unconverted[0]).toContain(reason);
    }
  );
});

describe("valeFixtureScope", () => {
  it("admits under YES matchers and excludes under NO ones", () => {
    const config = [
      "[*.md]",
      "tskl) rule = hedge",
      "hedge.hedge = YES",
      "",
      "[docs/legacy/**]",
      "tskl) rule = hedge",
      "hedge.hedge = NO",
      "",
    ].join("\n");
    expect(valeFixtureScope("hedge", config)).toEqual({
      include: ["*.md"],
      exclude: ["docs/legacy/**"],
    });
  });

  it("admits under a matcher that enables the rule with a level", () => {
    const config = "[docs/*.md]\nhedge.hedge = error\n";
    expect(valeFixtureScope("hedge", config)).toEqual({
      include: ["docs/*.md"],
      exclude: [],
    });
  });

  it("ignores another rule's key", () => {
    expect(
      valeFixtureScope("hedge", "[*.md]\nother.other = YES\n").include
    ).toEqual([]);
  });
});

describe("convertValeDocument", () => {
  it("makes a case named for the document's stem, at an admitted path", () => {
    const conversion = convertValeDocument(
      scope(["docs/**/*.md"]),
      "fail",
      "hedges.md",
      "Perhaps.\n",
      TESTS
    );
    expect(conversion).toEqual({
      files: [
        { path: "tests/fail/hedges/docs/hedges.md", content: "Perhaps.\n" },
      ],
      unconverted: [],
    });
  });

  it("suffixes a case whose stem another document already claimed", () => {
    const claimed = new Set<string>();
    const paths = ["hedges.md", "hedges.txt"].map(
      (name) =>
        convertValeDocument(
          scope(["*.md", "*.txt"]),
          "fail",
          name,
          "Perhaps.\n",
          TESTS,
          claimed
        ).files[0]?.path
    );
    expect(paths).toEqual([
      "tests/fail/hedges/hedges.md",
      "tests/fail/hedges-2/hedges.txt",
    ]);
  });

  it("names a document no admitted path can be derived for", () => {
    const conversion = convertValeDocument(
      scope(["*.md"], ["*.md"]),
      "pass",
      "quiet.md",
      "Fine.\n",
      TESTS
    );
    expect(conversion.files).toEqual([]);
    expect(conversion.unconverted[0]).toContain("pass/quiet.md");
  });
});

/** Convert a served set from `.tests/` into `tests/`, as delivery does. */
const convert = (
  engine: "sg" | "vale" | "runtime",
  ruleId: string,
  files: { path: string; content: string }[]
) => convertLegacyFileSet(engine, ruleId, files, LEGACY, TESTS);

describe("convertLegacyFileSet", () => {
  const SG_RULE =
    "id: no-eval\nlanguage: TypeScript\nseverity: error\nmessage: m\nrule:\n  pattern: eval($A)\n";

  it("converts a legacy ast-grep set into case directories", () => {
    const result = convert("sg", "no-eval", [
      { path: "no-eval.yml", content: SG_RULE },
      {
        path: ".tests/no-eval-test.yml",
        content: "id: no-eval\nvalid:\n  - ok()\ninvalid:\n  - eval(x)\n",
      },
    ]);
    expect(result.unconverted).toEqual([]);
    expect(result.files.map((file) => file.path)).toEqual([
      "no-eval.yml",
      "tests/pass/pass-01/pass-01.ts",
      "tests/fail/fail-01/fail-01.ts",
    ]);
  });

  it("keeps every snippet when a rule serves more than one test file", () => {
    const result = convert("sg", "no-eval", [
      { path: "no-eval.yml", content: SG_RULE },
      {
        path: ".tests/no-eval-20260101-test.yml",
        content: "invalid:\n  - eval(a)\n",
      },
      {
        path: ".tests/no-eval-20260301-test.yml",
        content: "invalid:\n  - eval(b)\n",
      },
    ]);
    expect(result.unconverted).toEqual([]);
    expect(result.files.slice(1)).toEqual([
      { path: "tests/fail/fail-01/fail-01.ts", content: "eval(a)\n" },
      { path: "tests/fail/fail-02/fail-02.ts", content: "eval(b)\n" },
    ]);
  });

  it("numbers past the cases the set already carries under tests/", () => {
    const result = convert("sg", "no-eval", [
      { path: "no-eval.yml", content: SG_RULE },
      { path: "tests/fail/fail-01/fail-01.ts", content: "eval(old)\n" },
      { path: ".tests/no-eval-test.yml", content: "invalid:\n  - eval(new)\n" },
    ]);
    expect(result.files.map((file) => file.path)).toEqual([
      "no-eval.yml",
      "tests/fail/fail-01/fail-01.ts",
      "tests/fail/fail-02/fail-02.ts",
    ]);
  });

  it("never converts a case onto a name a moved fixture keeps", () => {
    // An extensionless Vale document cannot be converted and moves as served
    // to tests/pass/a; the converted a.md must not become tests/pass/a/a.md.
    const result = convert("vale", "hedge", [
      {
        path: ".vale.ini",
        content: "[*]\ntskl) rule = hedge\nhedge.hedge = YES\n",
      },
      { path: ".tests/pass/a", content: "x\n" },
      { path: ".tests/pass/a.md", content: "Fine.\n" },
    ]);
    const paths = result.files.map((file) => file.path);
    expect(paths).toContain("tests/pass/a");
    expect(paths).toContain("tests/pass/a-2/a.md");
  });

  it("drops sg test snapshots, and names them", () => {
    const result = convert("sg", "no-eval", [
      { path: "no-eval.yml", content: SG_RULE },
      { path: ".tests/__snapshots__/no-eval-snapshot.yml", content: "x\n" },
      { path: ".tests/no-eval-test.yml", content: "invalid:\n  - eval(x)\n" },
    ]);
    expect(result.files.map((file) => file.path)).toEqual([
      "no-eval.yml",
      "tests/fail/fail-01/fail-01.ts",
    ]);
    expect(result.unconverted).toEqual([
      "__snapshots__/no-eval-snapshot.yml: an `sg test` snapshot, dropped",
    ]);
  });

  it("passes every non-fixture file through byte-identical", () => {
    const signed = { path: "no-eval.yml", content: SG_RULE };
    const result = convert("sg", "no-eval", [
      signed,
      { path: ".tests/no-eval-test.yml", content: "invalid:\n  - eval(x)\n" },
    ]);
    expect(result.files.find((file) => file.path === signed.path)).toEqual(
      signed
    );
  });

  it("returns a set already in the new layout unchanged", () => {
    const files = [
      { path: "no-eval.yml", content: SG_RULE },
      { path: "tests/pass/ok/ok.ts", content: "ok()\n" },
      { path: "tests/fail/bad/bad.ts", content: "eval(x)\n" },
    ];
    expect(convert("sg", "no-eval", files)).toEqual({
      files,
      unconverted: [],
    });
  });

  it("converts a legacy Vale document under its rule's matchers", () => {
    const result = convert("vale", "hedge", [
      { path: "hedge.yml", content: "extends: existence\n" },
      {
        path: ".vale.ini",
        content: "[docs/*.md]\ntskl) rule = hedge\nhedge.hedge = YES\n",
      },
      { path: ".tests/fail/hedges.md", content: "Perhaps.\n" },
    ]);
    expect(result.unconverted).toEqual([]);
    expect(result.files.map((file) => file.path)).toContain(
      "tests/fail/hedges/docs/hedges.md"
    );
  });

  it("only renames a runtime case's parent", () => {
    const result = convert("runtime", "logs", [
      { path: "check.ts", content: "export default async () => [];\n" },
      { path: ".tests/fail/two-files/a.ts", content: "a\n" },
      { path: ".tests/fail/two-files/b.ts", content: "b\n" },
    ]);
    expect(result.unconverted).toEqual([]);
    expect(result.files).toEqual([
      { path: "check.ts", content: "export default async () => [];\n" },
      { path: "tests/fail/two-files/a.ts", content: "a\n" },
      { path: "tests/fail/two-files/b.ts", content: "b\n" },
    ]);
  });

  it("moves a fixture it cannot place under tests/ as served, and reports it", () => {
    // Never back under `.tests/`: the CLI does not write a layout its own
    // `verify` does not read, and `verify` names what it finds there.
    const unplaceable = {
      path: ".tests/no-eval-test.yml",
      content: "invalid:\n  - eval(x)\n",
    };
    const result = convert("sg", "no-eval", [
      {
        path: "no-eval.yml",
        content: `${SG_RULE}files:\n  - "src/**/*.ts"\nignores:\n  - "src/**"\n`,
      },
      unplaceable,
    ]);
    expect(result.files).toContainEqual({
      path: "tests/no-eval-test.yml",
      content: unplaceable.content,
    });
    expect(result.files.some((file) => file.path.startsWith(".tests/"))).toBe(
      false
    );
    expect(result.unconverted).toHaveLength(1);
    expect(result.unconverted[0]).toContain("no-eval-test.yml");
  });
});
