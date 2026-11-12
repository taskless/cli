import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  attachLeafText,
  countErrorNodes,
  detectAstLanguage,
  dumpAst,
  filterByRange,
  parseDebugAst,
  parseInspectedLanguage,
  parseLineRange,
  renderAst,
  type AstNode,
} from "../src/rules/ast-dump";
import { AST_GREP_LANGUAGES } from "../src/rules/capabilities";
import { AST_GREP_LANGUAGE_EXTENSIONS } from "../src/rules/fixture-convert";
import { findSgBinary } from "../src/rules/scan";
import { builtCli } from "./support/built-cli";
import { cliRejectionToResult } from "./support/spawn-cli";

const execFileAsync = promisify(execFile);
const binPath = builtCli();

async function runCli(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        DO_NOT_TRACK: "1",
        TASKLESS_TELEMETRY_DISABLED: "1",
      },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    return cliRejectionToResult(error, [binPath, ...args]);
  }
}

/** Kinds in document order, indented by depth, for compact assertions. */
function outline(node: AstNode, depth = 0): string[] {
  const field = node.field === undefined ? "" : `${node.field}: `;
  return [
    `${"  ".repeat(depth)}${field}${node.kind}`,
    ...node.children.flatMap((child) => outline(child, depth + 1)),
  ];
}

const binary = ((): string | undefined => {
  try {
    return findSgBinary();
  } catch {
    return undefined;
  }
})();
const withSg = binary === undefined ? describe.skip : describe;

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "taskless-ast-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("parseDebugAst", () => {
  // Verbatim from `ast-grep run --debug-query=ast` at 0.51.1.
  const DUMP = [
    "Debug AST:",
    "program (0,0)-(1,0)",
    "  lexical_declaration (0,0)-(0,12)",
    "    variable_declarator (0,6)-(0,11)",
    "      name: identifier (0,6)-(0,7)",
    "      value: number (0,10)-(0,11)",
    "",
    "Error: Cannot parse query as a valid pattern.",
  ].join("\n");

  it("builds the tree with fields and 1-based lines", () => {
    const tree = parseDebugAst(DUMP);
    expect(outline(tree)).toEqual([
      "program",
      "  lexical_declaration",
      "    variable_declarator",
      "      name: identifier",
      "      value: number",
    ]);
    expect(tree.start).toEqual({ line: 1, column: 0 });
    expect(tree.children[0]?.children[0]?.children[1]?.end).toEqual({
      line: 1,
      column: 11,
    });
  });

  it("fails on a dump it does not recognize rather than guessing", () => {
    expect(() => parseDebugAst("Error: something else")).toThrow(
      /printed no AST/
    );
    expect(() =>
      parseDebugAst("Debug AST:\nprogram (0,0)-(0,1)\n  ??? what\n")
    ).toThrow(/Unexpected line/);
  });

  it("attaches source text to leaves, by byte column", () => {
    const source = 'const é = "ü";\n';
    const tree = parseDebugAst(
      [
        "Debug AST:",
        "program (0,0)-(1,0)",
        "  lexical_declaration (0,0)-(0,16)",
        "    variable_declarator (0,6)-(0,15)",
        "      name: identifier (0,6)-(0,8)",
        "      value: string (0,11)-(0,15)",
        "        string_fragment (0,12)-(0,14)",
      ].join("\n")
    );
    attachLeafText(tree, source);
    const declarator = tree.children[0]?.children[0];
    expect(declarator?.children[0]?.text).toBe("é");
    expect(declarator?.children[1]?.text).toBeUndefined();
    expect(declarator?.children[1]?.children[0]?.text).toBe("ü");
    expect(renderAst(tree)).toContain('      name: identifier [1:6-1:8] "é"');
  });
});

describe("parseLineRange", () => {
  it("accepts a line or an inclusive span", () => {
    expect(parseLineRange("7")).toEqual({ from: 7, to: 7 });
    expect(parseLineRange("3:9")).toEqual({ from: 3, to: 9 });
  });

  it("rejects anything else", () => {
    for (const value of ["", "0", "9:3", "a", "3-9", "3:", ":3", "-1"]) {
      expect(parseLineRange(value)).toBeUndefined();
    }
  });
});

/** A node from line/column pairs, for range tests. */
function node(
  kind: string,
  from: [number, number],
  to: [number, number],
  children: AstNode[] = []
): AstNode {
  return {
    kind,
    start: { line: from[0], column: from[1] },
    end: { line: to[0], column: to[1] },
    children,
  };
}

describe("filterByRange", () => {
  const tree = node(
    "program",
    [1, 0],
    [4, 0],
    [
      node("a", [1, 0], [2, 0]),
      node("b", [2, 0], [2, 5]),
      node("c", [3, 0], [3, 4]),
    ]
  );

  it("keeps the nodes on the lines and the ones enclosing them", () => {
    expect(outline(filterByRange(tree, { from: 2, to: 2 })!)).toEqual([
      "program",
      "  b",
    ]);
  });

  it("does not count a node ending at column 0 as on that line", () => {
    expect(
      filterByRange(tree, { from: 2, to: 3 })?.children.map((c) => c.kind)
    ).toEqual(["b", "c"]);
  });

  it("is undefined past the end of the tree", () => {
    expect(filterByRange(tree, { from: 4, to: 9 })).toBeUndefined();
  });
});

describe("parseInspectedLanguage", () => {
  it("reads the language of the file entity", () => {
    expect(
      parseInspectedLanguage(
        "sg: summary|project: isProject=false\nsg: entity|file|a.ts: language=TypeScript,appliedRuleCount=0\n"
      )
    ).toBe("TypeScript");
  });

  it("is undefined for a skipped or unreported file", () => {
    expect(
      parseInspectedLanguage("sg: entity|file|x.dart: skipped=emptyFile\n")
    ).toBeUndefined();
    expect(parseInspectedLanguage("")).toBeUndefined();
  });
});

withSg("against the bundled ast-grep", () => {
  it.each(AST_GREP_LANGUAGES)(
    "dumps a %s file in the format the parser expects",
    async (language) => {
      const tree = await dumpAst({
        binary: binary!,
        cwd,
        source: "x\ny\n",
        language,
      });
      expect(tree.start.line).toBeGreaterThanOrEqual(1);
      expect(renderAst(tree).length).toBeGreaterThan(0);
    }
  );

  it("resolves each language's own extension to that language", async () => {
    for (const language of AST_GREP_LANGUAGES) {
      const file = `sample.${AST_GREP_LANGUAGE_EXTENSIONS[language]}`;
      await writeFile(join(cwd, file), "x\n");
      expect(await detectAstLanguage(binary!, cwd, file)).toBe(language);
    }
  });

  it("resolves extensions beyond the one per language, as check would", async () => {
    await writeFile(join(cwd, "a.mjs"), "x\n");
    await writeFile(join(cwd, "a.yaml"), "x: 1\n");
    expect(await detectAstLanguage(binary!, cwd, "a.mjs")).toBe("JavaScript");
    expect(await detectAstLanguage(binary!, cwd, "a.yaml")).toBe("Yaml");
  });

  it("ignores an sgconfig.yml's languageGlobs, which check does not use", async () => {
    await writeFile(
      join(cwd, "sgconfig.yml"),
      'ruleDirs: []\nlanguageGlobs:\n  TypeScript: ["*.weird"]\n'
    );
    await writeFile(join(cwd, "a.weird"), "x\n");
    expect(await detectAstLanguage(binary!, cwd, "a.weird")).toBeUndefined();
  });

  it("dumps the text as written, not as a preprocessed pattern", async () => {
    // `$FOO` is metavariable-shaped, and PHP is a language whose patterns
    // rewrite `$`. The dump must still show the variable the file holds.
    const tree = await dumpAst({
      binary: binary!,
      cwd,
      source: "<?php\n\n  $FOO = 1;\n",
      language: "Php",
    });
    expect(outline(tree)).toContain("      left: variable_name");
    expect(tree.children[1]?.start).toEqual({ line: 3, column: 2 });
  });

  it("counts ERROR nodes in a file that does not parse", async () => {
    const tree = await dumpAst({
      binary: binary!,
      cwd,
      source: "const = ;\n",
      language: "JavaScript",
    });
    expect(countErrorNodes(tree)).toBeGreaterThan(0);
  });
});

describe("taskless ast", () => {
  it("prints the named-node tree of a file, by its extension", async () => {
    await writeFile(join(cwd, "a.ts"), "const a = 1;\nfoo(a);\n");
    const result = await runCli(["ast", "a.ts"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("a.ts as TypeScript");
    expect(result.stdout).toContain("  lexical_declaration [1:0-1:12]");
    expect(result.stdout).toContain('      name: identifier [1:6-1:7] "a"');
    expect(result.stdout).toContain("call_expression");
    // Named nodes only: the `const` keyword is not a kind.
    expect(result.stdout).not.toMatch(/^\s*const\b/m);
  });

  it("emits the tree as JSON", async () => {
    await writeFile(join(cwd, "a.py"), "def f():\n    return 1\n");
    const result = await runCli(["ast", "a.py", "--json", "-d", cwd], cwd);
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      language: string;
      errorNodes: number;
      root: AstNode;
    };
    expect(output.ok).toBe(true);
    expect(output.language).toBe("Python");
    expect(output.errorNodes).toBe(0);
    expect(outline(output.root)).toContain("  function_definition");
  });

  it("cuts the tree to --range", async () => {
    await writeFile(join(cwd, "a.js"), "const a = 1;\nconst b = 2;\nfoo(b);\n");
    const result = await runCli(["ast", "a.js", "--range", "3", "--json"], cwd);
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as {
      range: unknown;
      root: AstNode;
    };
    expect(output.range).toEqual({ from: 3, to: 3 });
    expect(output.root.children.map((child) => child.kind)).toEqual([
      "expression_statement",
    ]);
  });

  it("parses as --lang when given, and dumps a file starting with -", async () => {
    await writeFile(join(cwd, "list.txt"), "- a\n- b\n");
    const result = await runCli(
      ["ast", "list.txt", "--lang", "yaml", "--json"],
      cwd
    );
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as {
      language: string;
      root: AstNode;
    };
    expect(output.language).toBe("Yaml");
    expect(outline(output.root).join("\n")).toContain("block_sequence_item");
  });

  it.each([
    [["ast", "missing.ts"], /No such file/],
    [["ast", "notes.unknownext"], /does not recognize the extension/],
    [["ast", "a.ts", "--lang", "C#"], /has no language "C#"/],
    [["ast", "a.ts", "--range", "5:2"], /--range takes/],
    [["ast", "a.ts", "--range", "40"], /No node touches --range 40/],
    [["ast", "empty.ts"], /is empty/],
  ])("refuses %j with INVALID_INPUT", async (args, message) => {
    await writeFile(join(cwd, "a.ts"), "let a = 1;\n");
    await writeFile(join(cwd, "notes.unknownext"), "hello\n");
    await writeFile(join(cwd, "empty.ts"), "");
    const result = await runCli([...args, "--json"], cwd);
    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout) as {
      ok: boolean;
      code: string;
      message: string;
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("INVALID_INPUT");
    expect(envelope.message).toMatch(message);
  });

  it("says a file too large for the command line is too large", async () => {
    await writeFile(join(cwd, "big.js"), "a;\n".repeat(500_000));
    const result = await runCli(["ast", "big.js", "--json"], cwd);
    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout) as {
      code: string;
      message: string;
    };
    expect(envelope.code).toBe("INVALID_INPUT");
    expect(envelope.message).toMatch(/too large to dump/);
  });
});
