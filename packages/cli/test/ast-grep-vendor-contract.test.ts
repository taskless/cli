import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assembleSgConfig } from "../src/rules/assemble";
import {
  AST_GREP_LANGUAGE_ALIASES,
  AST_GREP_LANGUAGES,
  AST_GREP_VERSION,
  astGrepLanguageList,
  resolveAstGrepLanguage,
} from "../src/rules/capabilities";
import { ruleDirectory } from "../src/rules/engines";
import { AST_GREP_LANGUAGE_EXTENSIONS } from "../src/rules/fixture-convert";
import {
  buildPath,
  findSgBinary,
  parseReachedFiles,
  stripSgDeprecationBanner,
} from "../src/rules/scan";

/**
 * ast-grep's observable behaviour, pinned.
 *
 * Everything here is a property of a **vendored third-party binary**, exact-
 * pinned at `0.45.3` in `packages/cli/package.json`. Our own tests assert that
 * our code behaves correctly *given* these; this file asserts the givens, so an
 * ast-grep bump that changes one fails here — naming the assumption and the
 * code that rests on it — instead of surfacing downstream.
 *
 * It matters more here than for Vale, because the ast-grep failure mode is
 * quiet: `runAstGrepScan` treats exit 0 and 1 as normal and silently discards
 * stdout lines that do not parse, so a scan that matched nothing because
 * discovery changed is indistinguishable from a clean codebase.
 *
 * Each case says what breaks if it changes. These invoke the binary directly
 * rather than through `runAstGrepScan`, deliberately: a test that
 * went through our wrapper would be asserting our interpretation of ast-grep,
 * which is the thing under test everywhere else.
 */

/**
 * `findSgBinary` throws rather than returning `undefined` — ast-grep has no
 * degraded mode — so absence is caught here to skip rather than to fail.
 */
const binary = ((): string | undefined => {
  try {
    return findSgBinary();
  } catch {
    return undefined;
  }
})();
const withSg = binary === undefined ? describe.skip : describe;

const workspaces: string[] = [];
afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

const rule = (id: string, severity = "error") =>
  [
    `id: ${id}`,
    "language: TypeScript",
    `severity: ${severity}`,
    `message: no eval`,
    "note: prefer a real parser",
    "rule:",
    "  pattern: eval($$$A)",
    "",
  ].join("\n");

/** A Haskell rule that matches on `kind` alone. */
const haskellKindRule = (kind: string) =>
  [
    "id: synonym",
    "language: Haskell",
    "severity: error",
    "message: m",
    "rule:",
    `  kind: ${kind}`,
    "",
  ].join("\n");

interface Project {
  /** Rule id to rule YAML. Each becomes `rules/<id>/<id>.yml`. */
  rules: Record<string, string>;
  /** Path relative to the project root, to file contents. */
  sources?: Record<string, string>;
}

/**
 * A throwaway ast-grep project.
 *
 * The `sgconfig.yml` is written literally rather than through
 * `assembleSgConfig`, so what is pinned is the binary's response to a config,
 * not our assembler's idea of one. The discovery cases at the bottom of this
 * file are the deliberate exception: there, our layout is the thing being
 * checked against discovery.
 */
function project({ rules, sources = {} }: Project): string {
  const cwd = mkdtempSync(join(tmpdir(), "sg-contract-"));
  workspaces.push(cwd);

  for (const [id, body] of Object.entries(rules)) {
    mkdirSync(join(cwd, "rules", id), { recursive: true });
    writeFileSync(join(cwd, "rules", id, `${id}.yml`), body);
  }
  for (const [path, body] of Object.entries(sources)) {
    // The parent of the path actually given, not a hardcoded `src/` — every
    // case today happens to live under `src/`, and a future one that does not
    // should not fail with ENOENT.
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), body);
  }

  writeFileSync(join(cwd, "sgconfig.yml"), "ruleDirs:\n  - rules\n");
  return cwd;
}

const run = (cwd: string, argv: string[]) =>
  spawnSync(binary as string, argv, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: buildPath() },
  });

/** `scan`, exactly as `runAstGrepScan` invokes it. */
const scan = (cwd: string, config = "sgconfig.yml") =>
  run(cwd, ["scan", "--config", config, "--json=stream"]);

/** One eval call, at line 0 column 10 of `src/a.ts`. */
const evalSource = { "src/a.ts": 'const x = eval("1");\n' };

/** `rule("no-eval")` with its `language:` swapped for another spelling. */
const atLanguage = (language: string) =>
  rule("no-eval").replace("language: TypeScript", `language: ${language}`);

/**
 * A rule declaring `language` verbatim, over a pattern given verbatim.
 *
 * `atLanguage` cannot serve the alias cases: it keeps `eval($$$A)`, which only
 * parses as JavaScript-family source. Each language below needs a pattern its
 * own grammar accepts.
 */
const langRule = (language: string, pattern: string) =>
  [
    "id: lang",
    `language: ${language}`,
    "severity: error",
    "message: lang",
    "note: n",
    "rule:",
    `  pattern: ${pattern}`,
    "",
  ].join("\n");

/**
 * One file per language that has an alias, holding an identifier `zzz` the
 * pattern beside it matches.
 *
 * Sources are deliberately the smallest thing each grammar accepts, because
 * the assertion is about which parser ast-grep picked, not about matching.
 * `CSharp` is the one that needs more than a bare identifier pattern — measured
 * at 0.41.0, `pattern: zzz` parses but matches nothing there.
 */
const languageFixture: Record<
  string,
  { file: string; source: string; pattern: string }
> = {
  Cpp: { file: "src/a.cpp", source: "int zzz = 1;\n", pattern: "zzz" },
  CSharp: {
    file: "src/a.cs",
    source: "class A { void M() { int zzz = 1; } }\n",
    pattern: "int zzz = 1",
  },
  Elixir: { file: "src/a.ex", source: "zzz = 1\n", pattern: "zzz" },
  Go: {
    file: "src/a.go",
    source: "package main\n\nvar zzz = 1\n",
    pattern: "zzz",
  },
  Haskell: { file: "src/a.hs", source: "zzz = 1\n", pattern: "zzz" },
  JavaScript: { file: "src/a.js", source: "var zzz = 1\n", pattern: "zzz" },
  Kotlin: { file: "src/a.kt", source: "val zzz = 1\n", pattern: "zzz" },
  Python: { file: "src/a.py", source: "zzz = 1\n", pattern: "zzz" },
  Ruby: { file: "src/a.rb", source: "zzz = 1\n", pattern: "zzz" },
  Rust: {
    file: "src/a.rs",
    source: "fn main() { let zzz = 1; }\n",
    pattern: "zzz",
  },
  Solidity: {
    file: "src/a.sol",
    source: "contract A { uint zzz = 1; }\n",
    pattern: "zzz",
  },
  TypeScript: { file: "src/a.ts", source: "var zzz = 1\n", pattern: "zzz" },
  Yaml: { file: "src/a.yml", source: "zzz: 1\n", pattern: "zzz" },
};

/**
 * The canonical language ast-grep says it used, for a rule that declared
 * `spelling`.
 *
 * READ OUT OF THE BINARY, NOT ASSUMED. Every match on the `--json=stream`
 * output carries a `language` field naming the parser that produced it, so an
 * alias's resolution is ast-grep's own answer rather than a claim of ours
 * inferred from which files got scanned.
 */
const resolvedLanguage = (spelling: string, expected: string) => {
  const fixture = languageFixture[expected];
  if (fixture === undefined) throw new Error(`no fixture for ${expected}`);
  const line = scan(
    project({
      rules: { lang: langRule(spelling, fixture.pattern) },
      sources: { [fixture.file]: fixture.source },
    })
  )
    .stdout.split("\n")
    .find((text) => text !== "");
  return line === undefined
    ? undefined
    : (JSON.parse(line) as { language: string }).language;
};

/**
 * Whether ast-grep recognized `language: <spelling>` as a language at all.
 *
 * KEYED ON `SgLang`, NOT ON THE EXIT STATUS. Every rule that fails to load
 * exits 8 with the same top-line `Cannot parse rule` message, and `pattern:
 * zzz` is legitimately unparseable in several grammars (`Html` wants a `kind`)
 * — so status alone cannot tell "not a language" from "not a pattern". The
 * `Caused by` chain does: `did not match any variant of untagged enum SgLang`
 * appears only for an unrecognized name, and it is the exact failure this
 * whole suite exists to keep out of `check`.
 */
const languageRecognized = (spelling: string) =>
  !scan(
    project({ rules: { lang: langRule(spelling, "zzz") } })
  ).stderr.includes("SgLang");

/** Four calls at increasing arity, one per line, for the `$$$` cases below. */
const aritySource = {
  "src/a.ts": "foo();\nfoo(1);\nfoo(1,2);\nfoo(1,2,3);\n",
};

/** A rule whose `rule:` body is given verbatim, already indented. */
const arityRule = (body: string) =>
  [
    "id: arity",
    "language: TypeScript",
    "severity: error",
    "message: arity",
    "note: n",
    "rule:",
    body,
    "",
  ].join("\n");

/** Findings from one semantics rule over one source file, text and message. */
const semanticsFindings = (body: string, source: string) =>
  scan(
    project({
      rules: { semantics: semanticsRule(body) },
      sources: { "src/a.ts": source },
    })
  )
    .stdout.split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { text: string; message: string });

/** The statement `nthChild` selects at `position`, over three siblings. */
const nthChildAt = (position: number) =>
  semanticsFindings(
    [
      "  kind: expression_statement",
      "  nthChild:",
      `    position: ${String(position)}`,
      "    ofRule: { pattern: $S }",
    ].join("\n"),
    "function f() { a(); b(); c(); }\n"
  ).map((match) => match.text);

/**
 * A rule whose `message` is a bare metavariable, so a leaked binding is
 * visible in the rendered output rather than only in the match.
 */
const semanticsRule = (body: string) =>
  [
    "id: semantics",
    "language: TypeScript",
    "severity: error",
    "message: $A",
    "note: n",
    "rule:",
    body,
    "",
  ].join("\n");

/**
 * Every finding `rule("no-eval")` produces over one source file, in stream
 * order — including the built-in `unused-suppression` rule's, which is why
 * `ruleId` and `severity` are read rather than assumed.
 */
const findingsFor = (source: string) =>
  scan(
    project({
      rules: { "no-eval": rule("no-eval") },
      sources: { "src/a.ts": source },
    })
  )
    .stdout.split("\n")
    .filter((line) => line !== "")
    .map(
      (line) =>
        JSON.parse(line) as {
          ruleId: string;
          severity: string;
          text: string;
          note: unknown;
        }
    );

/** A Markdown rule whose `rule:` body is given verbatim, already indented. */
const markdownRule = (body: string) =>
  [
    "id: md",
    "language: Markdown",
    "severity: error",
    "message: md",
    "note: n",
    "rule:",
    body,
    "",
  ].join("\n");

/** Exit status of scanning one finding declared at `severity`. */
const statusAt = (severity: string) =>
  scan(
    project({
      rules: { "no-eval": rule("no-eval", severity) },
      sources: evalSource,
    })
  ).status;

/**
 * Scan one rule, `rule:` body verbatim, over one source file. `TypeScript`
 * reads `src/a.ts` and `Tsx` reads `src/a.tsx`, since each parser claims only
 * its own extension.
 */
const grammarFindings = (
  body: string,
  source: string,
  language: "TypeScript" | "Tsx" = "TypeScript"
) =>
  scan(
    project({
      rules: {
        grammar: [
          "id: grammar",
          `language: ${language}`,
          "severity: error",
          "message: grammar",
          "note: n",
          "rule:",
          body,
          "",
        ].join("\n"),
      },
      sources: {
        [language === "Tsx" ? "src/a.tsx" : "src/a.ts"]: source,
      },
    })
  );

/** The text each finding matched, in file order. */
const grammarMatches = (
  body: string,
  source: string,
  language: "TypeScript" | "Tsx" = "TypeScript"
): string[] =>
  grammarFindings(body, source, language)
    .stdout.split("\n")
    .filter((line) => line !== "")
    .map((line) => (JSON.parse(line) as { text: string }).text);

/** The call each finding matched, in file order — i.e. the arities accepted. */
const arityMatches = (body: string): string[] =>
  grammarMatches(body, aritySource["src/a.ts"]);

/**
 * The files `scan` reported, run as `runAstGrepScan` runs it over a fixture
 * case: under `configPath`, walking hidden directories.
 */
const scannedFiles = (cwd: string, configPath: string): string[] =>
  run(cwd, [
    "scan",
    "--config",
    configPath,
    "--json=stream",
    "--no-ignore",
    "hidden",
  ])
    .stdout.split("\n")
    .filter((line) => line !== "")
    .map((line) => (JSON.parse(line) as { file: string }).file);

/** A fresh directory for one scope case, removed after the test. */
function scopeWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "sg-contract-scope-"));
  workspaces.push(directory);
  return directory;
}

withSg("ast-grep vendor contract", () => {
  it("reports its own name in --version", () => {
    // Depended on by: AST_GREP_BINARY.identity (/ast-grep/i) in rules/ast-grep-binary.ts. The
    // resolver runs each candidate because `@ast-grep/cli`'s postinstall can
    // leave a placeholder text file at the binary path. If ast-grep stops
    // saying "ast-grep" here, findSgBinary rejects the real binary and throws
    // "ast-grep binary not found" — fatal for every sg rule.
    const result = spawnSync(binary as string, ["--version"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/ast-grep/i);
  });

  describe("--inspect entity", () => {
    it("names each walked file and how many rules applied to it, on stderr", () => {
      // Depended on by: parseReachedFiles in rules/scan.ts, which is how
      // verify tells a fixture case the rule never read from one it read and
      // stayed quiet on. If the line shape changes, every case reads as never
      // read and verify fails loudly; if it moves to stdout, the findings
      // stream would carry it. Out-of-scope files report 0, and a gitignored
      // or empty file is not listed at all.
      const cwd = project({
        rules: {
          "no-eval": `${rule("no-eval")}files:\n  - "src/**/*.ts"\n`,
        },
        sources: {
          ...evalSource,
          "src/empty.ts": "",
          "lib/b.ts": "const b = 1;\n",
          "dist/c.ts": "const c = 1;\n",
        },
      });
      spawnSync("git", ["init", "-q"], { cwd });
      writeFileSync(join(cwd, ".gitignore"), "dist/\n");
      const result = run(cwd, [
        "scan",
        "--config",
        "sgconfig.yml",
        "--json=stream",
        "--inspect",
        "entity",
        "--no-ignore",
        "hidden",
      ]);
      expect(result.stdout).not.toContain("entity|");
      expect(result.stderr).toContain(
        "sg: entity|file|src/a.ts: language=TypeScript,appliedRuleCount=1"
      );
      expect(result.stderr).toContain(
        "sg: entity|file|lib/b.ts: language=TypeScript,appliedRuleCount=0"
      );
      expect(parseReachedFiles(result.stderr)).toEqual(["src/a.ts"]);
    });
  });

  describe("--json=stream", () => {
    it("emits one JSON object per line on stdout, with nothing else", () => {
      // Depended on by: runAstGrepScan reading stdout through readline and
      // JSON.parsing each line, discarding anything that does not parse. An
      // interleaved status line would be swallowed silently; a change to a
      // pretty-printed array would make EVERY line unparseable and report an
      // empty scan as a clean codebase.
      const cwd = project({
        rules: { "no-eval": rule("no-eval") },
        sources: {
          ...evalSource,
          "src/b.ts": 'const y = eval("2");\n',
        },
      });
      const result = scan(cwd);
      const lines = result.stdout.split("\n").filter((line) => line !== "");
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(() => {
          JSON.parse(line);
        }).not.toThrow();
      }
      // The "N error(s) found" banner goes to stderr, not into the stream.
      expect(result.stderr).toContain("error(s) found");
    });

    it("carries the field names AstGrepMatch reads", () => {
      // Depended on by: AstGrepMatch in types/check.ts and toCheckResult. A
      // rename arrives as `undefined` inside a CheckResult rather than as an
      // error — a finding with no message, or no file.
      const cwd = project({
        rules: { "no-eval": rule("no-eval") },
        sources: evalSource,
      });
      const match = JSON.parse(scan(cwd).stdout.split("\n")[0] ?? "") as Record<
        string,
        unknown
      >;
      for (const field of [
        "ruleId",
        "severity",
        "message",
        "note",
        "text",
        "file",
        "range",
      ]) {
        expect(match, `missing ${field}`).toHaveProperty(field);
      }
      expect(match.ruleId).toBe("no-eval");
      expect(match.text).toBe('eval("1")');
      expect(match.file).toBe("src/a.ts");
      // `replacement` appears only for a rule with a `fix`; toCheckResult maps
      // it to an optional `fix`, so its absence here is the contract too.
      expect(match).not.toHaveProperty("replacement");
    });

    it("reports range line and column 0-based", () => {
      // Depended on by: util/format.ts and rules/runtime/narrow.ts, which both
      // render `line + 1` / `column + 1`. If ast-grep ever emitted 1-based
      // positions, every reported location would be off by one — no error,
      // just quietly wrong. `const x = eval("1");` puts the match at line 0,
      // columns 10-19.
      const cwd = project({
        rules: { "no-eval": rule("no-eval") },
        sources: evalSource,
      });
      const match = JSON.parse(scan(cwd).stdout.split("\n")[0] ?? "") as {
        range: {
          start: { line: number; column: number };
          end: { line: number; column: number };
        };
      };
      expect(match.range.start).toEqual({ line: 0, column: 10 });
      expect(match.range.end).toEqual({ line: 0, column: 19 });
    });
  });

  describe("severity", () => {
    it("emits hint, info, warning and error verbatim", () => {
      // Depended on by: AstGrepMatch.severity, typed as exactly those four.
      // Anything else arrives as a CheckResult with a severity outside the
      // union — TypeScript believes a value the binary never promised.
      for (const severity of ["hint", "info", "warning", "error"]) {
        const cwd = project({
          rules: { "no-eval": rule("no-eval", severity) },
          sources: evalSource,
        });
        const match = JSON.parse(scan(cwd).stdout.split("\n")[0] ?? "") as {
          severity: string;
        };
        expect(match.severity).toBe(severity);
      }
    });

    it("accepts exactly [hint info warning error off] and rejects the rest", () => {
      // The vocabulary is FIVE values, one more than AstGrepMatch's union —
      // `off` is accepted in a rule but disables it, so it can never appear in
      // output (asserted below). A rule at any other severity fails the parse
      // rather than reaching us, which is what keeps the four-value union safe.
      //
      // ORDER CHANGED AT 0.45.3, vocabulary unchanged. `off` moved from last
      // to first, here and in the vendored schema's `Severity` enum alike:
      // `--min-severity` (ast-grep/ast-grep#2917) compares severities as an
      // ordered type, and `off` has to sort lowest for "off means no minimum"
      // to fall out of that comparison. Nothing of ours reads the order —
      // `validate` validates against the schema's `const` values, not their
      // position — so the exact text is pinned to make the next reorder
      // visible, not because anything depends on it.
      //
      // WORDING CHANGED AT 0.51.0, vocabulary and order unchanged. ast-grep
      // replaced serde_yaml with serde-saphyr (ast-grep/ast-grep#2999), which
      // drops the backticks around each variant and the `severity:` prefix.
      // `validate` rejects this severity against the schema before ast-grep
      // sees it, so no user reads this text through Taskless.
      const cwd = project({
        rules: { "no-eval": rule("no-eval", "catastrophe") },
        sources: evalSource,
      });
      const result = scan(cwd);
      expect(result.stderr).toContain(
        "unknown variant `catastrophe`, expected one of off, hint, info, warning, error"
      );
    });

    it("runs no rule at severity off, so `off` never reaches the stream", () => {
      const cwd = project({
        rules: { "no-eval": rule("no-eval", "off") },
        sources: evalSource,
      });
      const result = scan(cwd);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("");
    });
  });

  describe("scan exit codes", () => {
    // Depended on by: runAstGrepScan's boundary — "exit 1 means error-severity
    // matches were found; exit > 1 means the binary or config failed." That
    // single comparison is the whole difference between findings and engine
    // failure. If a config error ever exited 1, a broken engine would be
    // reported as a clean scan with no results.

    it("exits 0 for findings below error severity", () => {
      expect(statusAt("warning")).toBe(0);
      expect(statusAt("info")).toBe(0);
    });

    it("exits 1 for error-severity findings", () => {
      expect(statusAt("error")).toBe(1);
    });

    it("exits above 1 when the config or a rule cannot be read", () => {
      // Re-measured at 0.45.2, unchanged: 6 for a missing config, 8 for an
      // unparseable rule.
      // Only `> 1` is depended on; the exact numbers are recorded so a change
      // in them is visible without being treated as a break.
      const missing = scan(
        project({ rules: { "no-eval": rule("no-eval") } }),
        "nope.yml"
      );
      expect(missing.status).toBeGreaterThan(1);
      expect(missing.status).toBe(6);

      const unparseable = scan(
        project({
          rules: { "no-eval": rule("no-eval", "catastrophe") },
          sources: evalSource,
        })
      );
      expect(unparseable.status).toBeGreaterThan(1);
      expect(unparseable.status).toBe(8);
    });

    it("loads a rule file that ends in an empty document", () => {
      // RELAXED AT 0.51.0 by the serde-saphyr parser (ast-grep/ast-grep#2999).
      // Measured on 0.45.3, a trailing `---` read as a second rule with no
      // `language`, exited 8, and took every other rule in the config down
      // with it. `validate` still rejects the file as multi-document YAML,
      // but `check` hands rules to ast-grep as they are on disk, so this is
      // the difference between a project's findings and none at all.
      const cwd = project({
        rules: {
          "no-eval": `${rule("no-eval")}---\n`,
          other: rule("other"),
        },
        sources: evalSource,
      });
      const result = scan(cwd);
      expect(result.status).toBe(1);
      const ruleIds = result.stdout
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => (JSON.parse(line) as { ruleId: string }).ruleId);
      expect(ruleIds.toSorted()).toEqual(["no-eval", "other"]);
    });
  });

  describe("scan --filter", () => {
    it("treats --filter as an unanchored regex", () => {
      // Depended on by: sgFilterArgv anchoring the alternation as
      // `^(?:…)$`, which is how `check --rule` and each fixture case select
      // one rule. Without the anchors, scanning for `no-eval` would also run
      // `no-eval-strict` and report its findings under the wrong request.
      const cwd = project({
        rules: {
          "no-eval": rule("no-eval"),
          "no-eval-strict": rule("no-eval-strict"),
        },
        sources: evalSource,
      });
      const ruleIdsFor = (filter: string): string[] =>
        run(cwd, [
          "scan",
          "--config",
          "sgconfig.yml",
          "--json=stream",
          "--filter",
          filter,
        ])
          .stdout.split("\n")
          .filter((line) => line !== "")
          .map((line) => (JSON.parse(line) as { ruleId: string }).ruleId)
          .toSorted();

      expect(ruleIdsFor("^(?:no-eval)$")).toEqual(["no-eval"]);
      expect(ruleIdsFor("no-eval")).toEqual(["no-eval", "no-eval-strict"]);
    });
  });

  /**
   * How a wrong `language:` fails — the two shapes `route.md` warns about.
   *
   * Nothing of ours catches either one first: the vendored
   * `src/generated/ast-grep-rule-schema.json` types `$defs.Language` as a bare
   * string with no enum, and `validate` never reads the field. So the binary's
   * response IS the contract, and a recipe telling an author what to expect is
   * quoting it. These live beside the recipe that makes the claim, so the claim
   * and its pin land in the same change.
   */
  describe("the language field", () => {
    it("fails the whole scan on a spelling it does not recognize", () => {
      // `C#` is the plausible wrong spelling of `CSharp`, and getting it wrong
      // is not a rule that quietly matches nothing: ast-grep cannot parse the
      // config, so every OTHER rule in the project goes unreported too. The
      // error names the enum, which is what an author sees.
      const result = scan(
        project({ rules: { "no-eval": atLanguage("C#") }, sources: evalSource })
      );
      expect(result.status).toBeGreaterThan(1);
      expect(result.stderr).toContain("SgLang");
    });

    it("accepts off-list aliases, so an off-list spelling is not an error", () => {
      // The half that corrects an earlier claim in this branch's own history:
      // `C++` and `cpp` are NOT rejected, they resolve to Cpp. The recipe tells
      // authors to copy from the canonical list for the other two reasons, not
      // because every off-list spelling fails.
      const sources = {
        "src/a.cpp": "int main(){int simply=1;return simply;}\n",
      };
      for (const spelling of ["Cpp", "C++", "cpp"]) {
        const result = scan(
          project({ rules: { "no-eval": atLanguage(spelling) }, sources })
        );
        expect(result.status, `${spelling} was rejected`).not.toBeGreaterThan(
          1
        );
      }
    });

    it("treats Tsx and TypeScript as different parsers, not aliases", () => {
      // The quiet half of the same field, and the reason the recipe names this
      // pair specifically. `TypeScript` over a `.tsx` tree exits clean with no
      // findings, which is indistinguishable from a codebase with nothing to
      // flag — the rule looks written and proves nothing.
      const sources = { "src/a.tsx": "const el = <div>{eval(x)}</div>;\n" };
      const asTypeScript = scan(
        project({ rules: { "no-eval": atLanguage("TypeScript") }, sources })
      );
      expect(asTypeScript.status).toBe(0);
      expect(asTypeScript.stdout.trim()).toBe("");
      expect(
        scan(project({ rules: { "no-eval": atLanguage("Tsx") }, sources }))
          .stdout
      ).toContain("eval(x)");
    });

    it("accepts every canonical name lowercased", () => {
      // `validate` compares lowercased (see `resolveAstGrepLanguage`), which is
      // only safe because the binary does too. If a bump ever made one name
      // case-sensitive, `validate` would start passing a rule ast-grep refuses.
      for (const language of AST_GREP_LANGUAGES) {
        expect(
          languageRecognized(language.toLowerCase()),
          `${language.toLowerCase()} was rejected`
        ).toBe(true);
      }
    });

    it("resolves every alias to the language AST_GREP_LANGUAGE_ALIASES claims", () => {
      // The alias table is the ONE thing in `capabilities.ts` the binary
      // cannot be asked to enumerate — `sg run -h` prints only the canonical
      // list. So each entry is probed instead, and the resolution is read back
      // out of the scan stream rather than inferred.
      for (const [alias, canonical] of Object.entries(
        AST_GREP_LANGUAGE_ALIASES
      )) {
        expect(resolvedLanguage(alias, canonical), alias).toBe(canonical);
      }
    });

    it("rejects the near-misses that are not aliases", () => {
      // The direction the table cannot self-check: a bump that ADDS an alias
      // leaves `validate` failing a rule that now works. These are the spellings
      // an author is most likely to reach for — a header extension, a module
      // extension, a shell name, a Terraform name, a script suffix — and all
      // five were measured as rejected at 0.41.0.
      for (const spelling of ["h", "hpp", "mjs", "cjs", "sh", "tf", "csx"]) {
        expect(languageRecognized(spelling), `${spelling} was accepted`).toBe(
          false
        );
      }
    });

    it("does not fold surrounding whitespace", () => {
      // Why `resolveAstGrepLanguage` deliberately does not trim: a trimming
      // resolver would call this rule valid and ast-grep would still refuse to
      // load the config.
      expect(languageRecognized('"ts "')).toBe(false);
      expect(resolveAstGrepLanguage("ts ")).toBeUndefined();
    });
  });

  /**
   * What `$$$` does next to a comma — the mechanism behind #152.
   *
   * Depended on by: every recipe and curated example that tells an author how
   * to write a variadic pattern, and by the `strictness: ast` example in
   * `verify-examples.ts`. The failure mode is the quiet one this whole file
   * exists for: a pattern that reads as "any number of arguments" silently
   * matches a narrower set, the rule finds nothing, and `check` reports a
   * clean codebase.
   *
   * Upstream considers this working as intended (ast-grep/ast-grep#1365), and
   * all four arity cases were re-measured unchanged across the 0.41.0 to
   * 0.45.2 bump, so a version bump is not a fix. What a bump could do is
   * change it — which is what these cases are here to catch.
   */
  describe("$$$ next to a comma", () => {
    it("matches a zero-argument call when $$$ stands alone", () => {
      // The reported bug, and it is not real in this shape: a lone `$$$` does
      // mean "zero or more". `$$$` binding nothing was never the problem.
      expect(arityMatches("  pattern: foo($$$)")).toEqual([
        "foo()",
        "foo(1)",
        "foo(1,2)",
        "foo(1,2,3)",
      ]);
    });

    it("does NOT match a one-argument call for a trailing $A, $$$", () => {
      // The real bug. The pattern's `,` is itself a node, and under the
      // default `smart` strictness every node in the pattern must match — so
      // `foo(1)`, which has no comma, fails. The pattern reads as ">= 1
      // argument" and behaves as ">= 2".
      expect(arityMatches("  pattern: foo($A, $$$)")).toEqual([
        "foo(1,2)",
        "foo(1,2,3)",
      ]);
    });

    it("matches only the one-argument call for a leading $$$, $A", () => {
      // The mirror case, and the more surprising one: the separator forces a
      // comma, `$A` claims the last argument, and `$$$` is left unable to
      // spread — so this collapses to exactly one arity rather than widening.
      expect(arityMatches("  pattern: foo($$$, $A)")).toEqual(["foo(1)"]);
    });

    it("matches only the two-argument call when $$$ sits between two metavars", () => {
      // Both separators bind, so the "any number in the middle" reading is
      // wrong in both directions at once.
      expect(arityMatches("  pattern: foo($A, $$$, $B)")).toEqual(["foo(1,2)"]);
    });

    it("widens a trailing $A, $$$ to one argument under strictness: ast", () => {
      // The author-side remedy, and the reason `strictness` has to sit INSIDE
      // the pattern object: at rule level ast-grep rejects it as an unknown
      // field. `ast` compares named AST nodes and ignores the comma, so the
      // boundary moves from ">= 2" to ">= 1" — it does NOT reach `foo()`,
      // because `$A` still has to bind something.
      expect(
        arityMatches(
          [
            "  pattern:",
            "    context: foo($A, $$$)",
            "    selector: call_expression",
            "    strictness: ast",
          ].join("\n")
        )
      ).toEqual(["foo(1)", "foo(1,2)", "foo(1,2,3)"]);
    });

    it("accepts strictness only inside the pattern object, not at rule level", () => {
      // Pins the placement the remedy depends on. At rule level this is not a
      // no-op that quietly leaves `smart` in force — ast-grep fails the scan.
      const cwd = project({
        rules: {
          arity: arityRule("  pattern: foo($A, $$$)\n  strictness: ast"),
        },
        sources: aritySource,
      });
      const result = scan(cwd);
      expect(result.status).toBeGreaterThan(1);
      expect(result.stderr).toContain("strictness");
    });
  });

  /**
   * Relocated from `engine-layout.test.ts`, which existed only for these two.
   *
   * ast-grep's `ruleDirs` recurses and parses every `.yml` beneath it as a
   * rule, so a rule's tests have to live somewhere the rule walk does not
   * reach. A dot-directory is skipped; `tests/` and `__tests__/` are not, and
   * either fails the whole scan with `missing field 'language'`.
   *
   * Documented at `engines.ts` (RULE_TESTS_DIRECTORY) and `assemble.ts`
   * (assembleSgConfig). These two cases go through our own layout helpers
   * deliberately — what is being pinned is that OUR directory names survive
   * ast-grep's discovery. If it ever breaks, the recorded fallback is to
   * materialize a rules-only tree for ast-grep (design D2).
   */
  /**
   * WHAT `Markdown` ACTUALLY BUYS, ADDED AT 0.45.2.
   *
   * tree-sitter-markdown splits its grammar in two, block and inline, and
   * ast-grep exposes only the block tree. `route.md` and `create-sg-rule.md`
   * both make that claim in prose; these are the measurements behind it, so
   * the recipes cannot drift from the binary silently.
   *
   * The failure this prevents is the #152 shape in a new place: a rule that
   * reads as structural, is accepted, and matches nothing forever.
   */
  describe("Markdown sees blocks, not inline constructs", () => {
    /**
     * A document with a heading, a subheading, a list, a fence, a link and a
     * setext heading. The setext form is here because `route.md` routes
     * "docs must not use setext (`===`) headings" to `create-sg-rule`, so the
     * kind that rule would name has to be pinned like any other.
     */
    const markdownSource = {
      "docs/a.md": [
        "# Title",
        "",
        "Some prose with a [link](https://example.com) and **bold** text.",
        "",
        "## Section",
        "",
        "- one",
        "- two",
        "",
        "```",
        "no language here",
        "```",
        "",
        "Alternate",
        "=========",
        "",
      ].join("\n"),
    };

    const scanMarkdown = (body: string) =>
      scan(
        project({ rules: { md: markdownRule(body) }, sources: markdownSource })
      );

    const matchCount = (body: string): number =>
      scanMarkdown(body)
        .stdout.split("\n")
        .filter((line) => line !== "").length;

    // EVERY kind the recipes name, not just the ones a rule here happens to
    // use. `route.md` and `create-sg-rule.md` tell an agent that these seven
    // are the block tree, and an unrecognized `kind:` is not a zero-match: it
    // is exit 8 that aborts config parsing and takes every other rule's report
    // down with it (pinned below for `link`). So a bump that renames one of
    // these turns a recipe into instructions for writing a scan-killing rule,
    // and this is the only thing that would go red.
    it("matches block-level kinds", () => {
      expect(matchCount("  kind: document")).toBe(1);
      expect(matchCount("  kind: section")).toBe(2);
      expect(matchCount("  kind: atx_heading")).toBe(2);
      expect(matchCount("  kind: setext_heading")).toBe(1);
      expect(matchCount("  kind: fenced_code_block")).toBe(1);
      expect(matchCount("  kind: list_item")).toBe(2);
      // 4, not 1: a list item wraps its text in a paragraph, and so does the
      // setext heading.
      expect(matchCount("  kind: paragraph")).toBe(4);
    });

    /** The text each finding matched, trimmed, in file order. */
    const matchTexts = (body: string): string[] =>
      scanMarkdown(body)
        .stdout.split("\n")
        .filter((line) => line !== "")
        .map((line) => (JSON.parse(line) as { text: string }).text.trim());

    it("discriminates heading level, so `# $T` is not `## $T`", () => {
      expect(matchTexts("  pattern: '# $T'")).toEqual(["# Title"]);
      expect(matchTexts("  pattern: '## $T'")).toEqual(["## Section"]);
    });

    it("collapses a line's contents into one opaque `inline` node", () => {
      // The paragraph HAS a link and bold text. `inline` is as deep as the
      // tree goes, which is why "link text must not say click here" is a Vale
      // rule and not this.
      const inlines = scanMarkdown("  kind: inline")
        .stdout.split("\n")
        .filter((line) => line !== "")
        .map((line) => (JSON.parse(line) as { text: string }).text);
      expect(inlines).toContain(
        "Some prose with a [link](https://example.com) and **bold** text."
      );
    });

    it("rejects `kind: link` as a config error rather than matching nothing", () => {
      // LOUD, and worth knowing it is loud: exit 8 with `Kind `link` is
      // invalid`, which aborts config parsing and takes every other rule's
      // report down with it, the same shape as the `C#` case, not the quiet one.
      const outcome = scanMarkdown("  kind: link");
      expect(outcome.status).toBe(8);
      expect(outcome.stderr).toContain("Kind `link` is invalid");
    });

    it("accepts an inline-shaped PATTERN and matches nothing, silently", () => {
      // The quiet half of the same gap, and the reason the recipes say this
      // out loud: no error, no finding, exit 0.
      const outcome = scanMarkdown("  pattern: '[$T]($U)'");
      expect(outcome.status).toBe(0);
      expect(outcome.stdout.trim()).toBe("");
    });
  });

  /**
   * TWO TYPESCRIPT GRAMMAR TRAPS, MEASURED AT 0.45.3.
   *
   * Long-standing grammar behavior, not something a bump introduced: both were
   * first measured at 0.45.3, while authoring rules on a real project.
   * `create-sg-rule.md` lists both under Quirks with a workaround each, and
   * every claim that section makes about them is pinned here, workarounds
   * included. If a grammar bump changes either, the recipe is describing a
   * parser that no longer exists, and this goes red.
   */
  describe("TypeScript keywords and awaited generic calls", () => {
    const parameterSource = [
      "class A { constructor(readonly a: number) {} }",
      "class B { constructor(private readonly b: number) {} }",
      "class C { constructor(@Inject() readonly c: number) {} }",
      "class D { constructor(readonly d?: number) {} }",
      "class E { constructor(x: readonly string[]) {} }",
      "class F { constructor(readonly: number) {} }",
      "class G { constructor(public g: number) {} }",
      "",
    ].join("\n");

    it("rejects an anonymous keyword token as a kind", () => {
      // The CST dump prints `readonly` as a node, which is what invites this.
      // `kind:` takes named nodes only, so it is exit 8 and every other rule's
      // report goes with it.
      const outcome = grammarFindings("  kind: readonly", parameterSource);
      expect(outcome.status).toBe(8);
      expect(outcome.stderr).toContain("Kind `readonly` is invalid");
    });

    it("matches every readonly parameter shape the recipe names, and no other", () => {
      // The recipe's workaround verbatim. An earlier `^readonly\b` over
      // `required_parameter` alone matched only A: an accessibility modifier or
      // a decorator comes first in the node's text, and `readonly d?` is an
      // `optional_parameter`. E and F are the false positives the anchor keeps
      // out.
      const pattern = String.raw`^(?:@\\S+\\s+)*(?:(?:public|private|protected)\\s+)?readonly\\s`;
      expect(
        grammarMatches(
          [
            "  any:",
            "    - kind: required_parameter",
            `      regex: "${pattern}"`,
            "    - kind: optional_parameter",
            `      regex: "${pattern}"`,
          ].join("\n"),
          parameterSource
        )
      ).toEqual([
        "readonly a: number",
        "private readonly b: number",
        "@Inject() readonly c: number",
        "readonly d?: number",
      ]);
    });

    const awaitSource = [
      'const r = await rpc<Foo>("x");',
      'const s = await rpc("y");',
      'const t = rpc<Foo>("z");',
      "",
    ].join("\n");

    const calleeRule = [
      "  kind: call_expression",
      '  has: { field: function, kind: identifier, regex: "^rpc$" }',
    ].join("\n");

    it("parses `await f<T>()` as a call of the await expression", () => {
      // The silent one: the generic awaited call is simply absent from the
      // findings, exit 0.
      expect(grammarMatches(calleeRule, awaitSource)).toEqual([
        'rpc("y")',
        'rpc<Foo>("z")',
      ]);
    });

    it("parses it the same way under Tsx", () => {
      expect(grammarMatches(calleeRule, awaitSource, "Tsx")).toEqual([
        'rpc("y")',
        'rpc<Foo>("z")',
      ]);
    });

    it("hides the callee behind `!`, `void` and `typeof` too, but not `yield`", () => {
      const source = [
        "function* g() {",
        '  !rpc<Foo>("a");',
        '  void rpc<Foo>("b");',
        '  typeof rpc<Foo>("c");',
        '  yield rpc<Foo>("d");',
        "}",
        "",
      ].join("\n");
      expect(grammarMatches(calleeRule, source)).toEqual(['rpc<Foo>("d")']);
      expect(
        grammarMatches(
          [
            "  kind: call_expression",
            "  has: { field: function, kind: unary_expression }",
          ].join("\n"),
          source
        )
      ).toEqual([
        '!rpc<Foo>("a")',
        'void rpc<Foo>("b")',
        'typeof rpc<Foo>("c")',
      ]);
    });

    it("recovers the awaited generic call with an await_expression branch", () => {
      // The recipe's workaround verbatim. The wrapped match spans the `await`,
      // which the recipe warns a `fix:` will rewrite along with the call.
      expect(
        grammarMatches(
          [
            "  kind: call_expression",
            "  has:",
            "    field: function",
            "    any:",
            "      - kind: identifier",
            '        regex: "^rpc$"',
            "      - kind: await_expression",
            '        has: { kind: identifier, regex: "^rpc$" }',
          ].join("\n"),
          awaitSource
        )
      ).toEqual(['await rpc<Foo>("x")', 'rpc("y")', 'rpc<Foo>("z")']);
    });

    it("recovers an awaited generic method call with a member_expression branch", () => {
      // The identifier branch alone finds none of these: under `await`, a
      // method callee is a member_expression, and the recipe says so.
      const property =
        'has: { field: property, kind: property_identifier, regex: "^rpc$" }';
      expect(
        grammarMatches(
          [
            "  kind: call_expression",
            "  has:",
            "    field: function",
            "    any:",
            "      - kind: member_expression",
            `        ${property}`,
            "      - kind: await_expression",
            "        has:",
            "          kind: member_expression",
            `          ${property}`,
          ].join("\n"),
          [
            "async function f() {",
            '  await this.rpc<Foo>("x");',
            '  await client.rpc<Foo>("y");',
            '  client.rpc("z");',
            "}",
            "",
          ].join("\n")
        )
      ).toEqual([
        'await this.rpc<Foo>("x")',
        'await client.rpc<Foo>("y")',
        'client.rpc("z")',
      ]);
    });
  });

  /**
   * Two matching-semantics fixes from the 0.41.0 to 0.45.2 upgrade, pinned
   * because they are the class no local check catches: a valid, unchanged rule
   * matching a DIFFERENT set of nodes, with no error and no warning.
   *
   * Both cases come from the upstream pull requests rather than from guessing
   * at the constructs. That distinction mattered: hand-written rules over the
   * same features showed no difference at all, because neither bug fires
   * unless a metavariable is bound in the specific position the fix changed.
   */
  describe("Haskell names a type synonym `type_synonym`", () => {
    // RENAMED AT 0.51.0, which moved tree-sitter-haskell from 0.23.1 to
    // 0.24.1. Upstream fixed a typo in the kind (`fix!: typo: 'synomym' ->
    // 'synonym'`). Diffed against both grammars' node-types.json, this is the
    // only named kind and the only field that changed. A rule still on the
    // old spelling exits 8, which takes every other sg rule in `check` down
    // with it; `validate` names the bad kind.
    const sources = { "src/a.hs": "type Name = String\n" };

    it("matches `type_synonym`", () => {
      const result = scan(
        project({
          rules: { synonym: haskellKindRule("type_synonym") },
          sources,
        })
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('"ruleId":"synonym"');
    });

    it("refuses the old `type_synomym` spelling", () => {
      const result = scan(
        project({
          rules: { synonym: haskellKindRule("type_synomym") },
          sources,
        })
      );
      expect(result.status).toBe(8);
      expect(result.stderr).toContain("Kind `type_synomym` is invalid");
    });
  });

  describe("metavariable bindings do not leak", () => {
    it("counts nthChild positions from 1, not from 0", () => {
      // Pinned because the vendored schema says otherwise. `NthChildSimple`
      // describes the plain-number form as "A number indicating the precise
      // element index" with `minimum: 0`, which reads as 0-indexed and would
      // make the test below off by one, selecting `c();` while claiming
      // `b();`.
      //
      // Measured against the binary: position 0 matches nothing at all, and
      // 1, 2, 3 select the first, second and third. The behaviour is CSS-like
      // and the schema's own description is misleading, so the ordering the
      // next test depends on is asserted here rather than assumed.
      expect(nthChildAt(0)).toEqual([]);
      expect(nthChildAt(1)).toEqual(["a();"]);
      expect(nthChildAt(2)).toEqual(["b();"]);
      expect(nthChildAt(3)).toEqual(["c();"]);
    });

    it("counts every sibling when nthChild's ofRule binds a metavariable", () => {
      // ast-grep/ast-grep#2677. `ofRule` reused one environment across all
      // siblings, so the first match committed `$S` and every later sibling
      // failed the consistency check and went uncounted. The rule then matched
      // NOTHING at 0.41.0 while looking correct.
      //
      // Measured across the upgrade: 0.41.0 found 0, 0.45.2 finds `b();`.
      // Swapping `pattern: $S` for a non-binding `kind:` was the workaround,
      // which is what identified binding as the cause.
      const matches = semanticsFindings(
        [
          "  kind: expression_statement",
          "  nthChild:",
          "    position: 2",
          "    ofRule: { pattern: $S }",
        ].join("\n"),
        "function f() { a(); b(); c(); }\n"
      );
      expect(matches.map((m) => m.text)).toEqual(["b();"]);
    });

    it("leaves a metavariable unbound when a negated not rejected it", () => {
      // ast-grep/ast-grep#2676. A `not` must contribute no bindings, since a
      // successful negation means the inner rule did NOT match. It passed the
      // live environment to its inner matcher, so a failed candidate left its
      // bindings behind, and relational rules reuse one environment across
      // candidates.
      //
      // The subtle part, and the reason this is asserted on the MESSAGE: the
      // finding itself is identical across the upgrade. Same file, same range,
      // same rule. Only the binding differs, so a differential comparing
      // locations would report no change. At 0.41.0 `$A` rendered as `foo`,
      // leaked from `return foo;`; here it must be empty.
      const matches = semanticsFindings(
        [
          "  kind: expression_statement",
          "  pattern: target;",
          "  follows:",
          "    not:",
          "      pattern: return $A",
          "    stopBy: end",
        ].join("\n"),
        "function f() { bar(); return foo; target; }\n"
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe("target;");
      expect(matches[0]?.message.trim()).toBe("");
    });
  });

  /**
   * Inline `ast-grep-ignore` comments in SCANNED code, and where the directive
   * has to sit to count. CHANGED AT 0.45.3 (ast-grep/ast-grep#2909).
   *
   * Nothing of ours writes these or documents them, but `check` scans whatever
   * source a project has, and ast-grep honours the comment wherever it finds
   * one — so a user's code carries this behaviour into `taskless check`
   * whether or not they wrote the comment for us. Through 0.45.2 the check was
   * a substring search: any comment CONTAINING `ast-grep-ignore` was a live
   * directive, so prose describing the mechanism above a flagged line
   * suppressed the finding, and prose with nothing to suppress was reported as
   * an unused directive. At 0.45.3 the directive must be the comment's first
   * alphabetic text.
   *
   * Both halves of that are the quiet kind: a finding appears that did not
   * before, or a hint stops appearing, and nothing says why. Measured against
   * both binaries, so each case below records which side of the bump it is on.
   */
  describe("inline ast-grep-ignore comments", () => {
    it("suppresses the next line, bare or naming the rule", () => {
      // The mechanism itself, unchanged across the bump and pinned so the
      // cases that follow are read against a working baseline rather than a
      // directive that stopped applying altogether.
      expect(
        findingsFor(
          [
            "// ast-grep-ignore",
            'const a = eval("1");',
            "// ast-grep-ignore: no-eval",
            'const b = eval("2");',
            "",
          ].join("\n")
        )
      ).toEqual([]);
    });

    it("no longer suppresses from a comment that mentions the directive as prose", () => {
      // CHANGED AT 0.45.3. At 0.45.2 this scan reported NOTHING: the
      // substring match read the prose as a directive and swallowed the
      // finding. A codebase whose comments discuss suppression now reports
      // the findings those comments sat on, which a rule author sees as new
      // errors from an unchanged rule.
      const findings = findingsFor(
        [
          "// see ast-grep-ignore: no-eval for how to suppress this",
          'const c = eval("3");',
          "",
        ].join("\n")
      );
      expect(findings.map((finding) => finding.ruleId)).toEqual(["no-eval"]);
      expect(findings[0]?.text).toBe('eval("3")');
    });

    it("no longer reports a prose mention as an unused directive", () => {
      // The other half of the same change, in the other direction: at 0.45.2
      // this scan produced an `unused-suppression` hint on the comment line.
      // A project that had been carrying that hint sees it disappear.
      expect(
        findingsFor(
          [
            "// This comment mentions ast-grep-ignore as prose",
            "const g = 1;",
            "",
          ].join("\n")
        )
      ).toEqual([]);
    });

    it("anchors on the first ALPHABETIC character, not the first character", () => {
      // The exact boundary upstream chose: everything before the first letter
      // is skipped, so the comment marker, extra whitespace, a block-comment
      // opener and even a leading list number are not prose. A directive
      // behind `// 1.` therefore still suppresses, which is the case an
      // author would guess wrong about from "must be first". (This comment
      // is itself scanned by the repo's own `check`, so no line of it may
      // start with the token — a wrapped one did, and was reported.)
      expect(
        findingsFor(
          [
            "/* ast-grep-ignore */",
            'const d = eval("4");',
            "//   ast-grep-ignore",
            'const e = eval("5");',
            "// 1. ast-grep-ignore",
            'const f = eval("6");',
            "",
          ].join("\n")
        )
      ).toEqual([]);
      // And one letter before it is enough to make it prose again.
      expect(
        findingsFor(
          ["// NOTE ast-grep-ignore", 'const h = eval("7");', ""].join("\n")
        ).map((finding) => finding.text)
      ).toEqual(['eval("7")']);
    });

    it("reports a genuinely unused directive on the stream as a hint", () => {
      // How a user sees any of this at all. `unused-suppression` is a built-in
      // rule, not one of ours, and it arrives on `--json=stream` like any
      // finding: `ruleId` is the built-in's name, `severity` is `hint` (inside
      // AstGrepMatch's union, so it renders), and `note` is `null` rather than
      // absent — `check.md` documents that shape, and `format.ts` tests
      // truthiness, so the null is tolerated rather than typed. A finding
      // that scoped its rule to something else counts as unused too, and the
      // finding it did not cover is reported beside it.
      const findings = findingsFor(
        [
          "// ast-grep-ignore",
          "const h = 1;",
          "// ast-grep-ignore: other-rule",
          'const i = eval("9");',
          "",
        ].join("\n")
      );
      expect(
        findings.map((finding) => [finding.ruleId, finding.severity])
      ).toEqual([
        ["no-eval", "error"],
        ["unused-suppression", "hint"],
        ["unused-suppression", "hint"],
      ]);
      expect(findings[1]?.note).toBeNull();
    });
  });

  describe("the `sg` alias prints a deprecation banner on stderr", () => {
    // DEPRECATED AT 0.45.0. `AST_GREP_BINARY.binaryNames` puts `ast-grep`
    // first, but the resolver reverses that list at its link-based tiers, so
    // on a host where only `sg` got linked every run carries this banner.
    // Both `runAstGrepScan` and `validate` decode ast-grep's stderr into
    // user-facing text, which is what `stripSgDeprecationBanner` exists for.
    const alias =
      binary === undefined ? undefined : join(dirname(binary), "sg");

    it("emits it, and stripSgDeprecationBanner removes exactly it", () => {
      const outcome = spawnSync(alias as string, ["--version"], {
        encoding: "utf8",
        env: { ...process.env, PATH: buildPath() },
      });
      // Skip rather than fail where the alias was not linked: the banner is a
      // property of the alias, and its absence is not an ast-grep change.
      if (outcome.error !== undefined) return;
      expect(outcome.stderr).toContain("`sg` is deprecated");
      expect(stripSgDeprecationBanner(outcome.stderr).trim()).toBe("");
    });
  });

  /**
   * Why ast-grep reads rules from a rules-only tree.
   *
   * A rule's fixtures live beside it, at `tests/<bucket>/<case>/`, and a
   * fixture is any file: an Actions rule's cases are `.yml` workflows.
   * ast-grep parses every `.yml` under a `ruleDirs` entry as a rule, so
   * pointing `ruleDirs` at the committed rules tree would read each fixture
   * as a broken rule and take the whole scan down. `assembleSgConfig` copies
   * each rule's `<id>.yml` into `.taskless/.sg-rules/` instead, and points
   * `ruleDirs` there.
   *
   * The dot in the old `.tests/` happened to keep its YAML out of discovery,
   * which is behavior ast-grep does not document. The rules-only tree means no
   * layout depends on it, so it is no longer pinned.
   */
  describe("rule discovery reads a rules-only tree", () => {
    const RULE = rule("no-eval");

    /** A throwaway root carrying our committed rule layout, with a YAML fixture. */
    function layout(): string {
      const cwd = mkdtempSync(join(tmpdir(), "sg-contract-layout-"));
      workspaces.push(cwd);
      const directory = ruleDirectory(cwd, "sg", "no-eval");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "no-eval.yml"), RULE);
      // A literal `tests/`, not the layout constant: what is pinned is how
      // ast-grep treats a plain directory, whatever the CLI calls its own.
      const fixture = join(directory, "tests", "pass", "workflow", "ci.yml");
      mkdirSync(dirname(fixture), { recursive: true });
      writeFileSync(fixture, "on: push\njobs: {}\n");
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(join(cwd, "src", "a.ts"), 'const x = eval("1");\n');
      return cwd;
    }

    it("fails the whole scan when ruleDirs reaches YAML in a plain tests/", () => {
      // Depended on by: assembleSgConfig building a rules-only tree. This is
      // the failure that tree exists to avoid: the fixture is not a rule, so
      // ast-grep refuses it, and with it every rule in the config.
      const cwd = layout();
      writeFileSync(
        join(cwd, "sgconfig.yml"),
        `ruleDirs:\n  - ${dirname(ruleDirectory(cwd, "sg", "no-eval"))}\n`
      );
      const result = scan(cwd);
      expect(result.status).toBeGreaterThan(1);
      expect(result.stderr).toContain("Cannot parse rule");
      expect(result.stderr).toContain(join("tests", "pass", "workflow"));
    });

    it("scans clean through the config assembleSgConfig writes", async () => {
      const cwd = layout();

      const configPath = await assembleSgConfig(cwd);
      expect(configPath).toBeDefined();

      // The rule fires (exit 1, error severity), which proves discovery ran;
      // the fixture beside it was never offered to ast-grep as a rule. A parse
      // failure produces no JSON at all.
      const result = scan(cwd, configPath ?? "");
      expect(result.status).toBe(1);
      const findings = result.stdout
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as { ruleId: string; file: string });
      expect(findings.map((finding) => finding.ruleId)).toEqual(["no-eval"]);
    });
  });

  /**
   * How a fixture case is scanned: from the case directory, under a config
   * that lives elsewhere.
   *
   * Depended on by: `runSgFixtures` in `sg-fixtures.ts`, which runs each case
   * with the case directory as the working directory and a one-rule config in
   * a temporary directory. A fixture exercises the rule's scope only because
   * `files:` resolves against the working directory, not against the config's
   * location. If that moved to the config, every scoped rule's fail cases
   * would go quiet, and every scoped rule would fail `verify`.
   */
  describe("files: globs resolve against the scan's working directory", () => {
    const SCOPED_RULE = [
      "id: no-latest",
      "language: Yaml",
      "severity: error",
      "message: m",
      "files:",
      '  - ".github/workflows/*.yml"',
      "rule:",
      "  kind: string_scalar",
      "  regex: '@latest'",
      "",
    ].join("\n");
    const OFFENDING = "steps:\n  - run: npx tool@latest\n";

    /** A config in its own directory, with an absolute `ruleDirs`. */
    function elsewhereConfig(workspace: string): string {
      const rules = join(workspace, "run", "rules");
      mkdirSync(rules, { recursive: true });
      writeFileSync(join(rules, "no-latest.yml"), SCOPED_RULE);
      const configPath = join(workspace, "run", "sgconfig.yml");
      writeFileSync(configPath, `ruleDirs:\n  - ${rules}\n`);
      return configPath;
    }

    /** A case directory holding `OFFENDING` at `path`. */
    function caseWith(workspace: string, path: string): string {
      const caseDirectory = join(workspace, "parent", "case");
      mkdirSync(dirname(join(caseDirectory, path)), { recursive: true });
      writeFileSync(join(caseDirectory, path), OFFENDING);
      return caseDirectory;
    }

    it("fires on a file at a path the glob admits, relative to the cwd", () => {
      const root = scopeWorkspace();
      const configPath = elsewhereConfig(root);
      const caseDirectory = caseWith(root, ".github/workflows/ci.yml");
      expect(scannedFiles(caseDirectory, configPath)).toEqual([
        ".github/workflows/ci.yml",
      ]);
    });

    it("stays quiet on the same file at the case root", () => {
      const root = scopeWorkspace();
      const configPath = elsewhereConfig(root);
      const caseDirectory = caseWith(root, "ci.yml");
      expect(scannedFiles(caseDirectory, configPath)).toEqual([]);
    });

    it("stays quiet when the same case is scanned from its parent", () => {
      // The glob is matched against the path from the cwd, which here is
      // `case/.github/workflows/ci.yml`. This is why a case is scanned with
      // its own directory as the cwd rather than passed as a path.
      const root = scopeWorkspace();
      const configPath = elsewhereConfig(root);
      const caseDirectory = caseWith(root, ".github/workflows/ci.yml");
      expect(scannedFiles(dirname(caseDirectory), configPath)).toEqual([]);
    });
  });
});

/**
 * The language reach `src/rules/capabilities.ts` publishes, pinned to the
 * binary that actually parses.
 *
 * Kept in its own top-level block rather than folded into the contract suite
 * above: those cases are about how ast-grep *behaves* when we drive it, and
 * these are about a constant we transcribed from it. A bump that adds or drops
 * a language fails here, which is the entire reason the list is a constant
 * instead of prose inside `route.md` — transcribed prose in a recipe has
 * nothing to go red, and a stale claim about what an engine can read is worse
 * than the silence it replaced, because an agent acts on it.
 *
 * See taskless/cli#151.
 */
/**
 * The bracketed list from `sg run -h`, which is the only place ast-grep
 * enumerates this. Not derived from anything we generate: the vendored
 * `src/generated/ast-grep-rule-schema.json` types `$defs.Language` as a bare
 * string with no enum, so our own generated artifacts cannot answer the question.
 * `validate` does validate a rule's `language` — against `AST_GREP_LANGUAGES` and
 * `AST_GREP_LANGUAGE_ALIASES`, which is exactly why both are pinned here.
 */
function reportedLanguages(): string[] {
  const help = spawnSync(binary as string, ["run", "-h"], {
    encoding: "utf8",
  });
  expect(help.status).toBe(0);
  const listed = /Supported languages are:\s*\[([^\]]*)\]/.exec(
    `${help.stdout}${help.stderr}`
  );
  expect(
    listed,
    "`sg run -h` no longer prints a bracketed language list"
  ).not.toBeNull();
  return (listed?.[1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

withSg("ast-grep engine capabilities", () => {
  it("reports the pinned version", () => {
    // AST_GREP_VERSION is what route.md renders next to the language list, so
    // an agent reading "ast-grep (v0.45.2) parses: …" is being told which
    // binary the claim came from. A bump that updates package.json and forgets
    // the constant makes that attribution a lie.
    const result = spawnSync(binary as string, ["--version"], {
      encoding: "utf8",
    });
    expect(result.stdout.trim()).toBe(`ast-grep ${AST_GREP_VERSION}`);
  });

  it("parses exactly the languages AST_GREP_LANGUAGES claims", () => {
    // Set equality in BOTH directions on purpose. A missing language narrows
    // what `route` believes is buildable locally and escalates rules to the
    // runtime tier for no reason; an extra one sends an agent to write a rule
    // whose `language:` the binary then rejects.
    expect([...reportedLanguages()].toSorted()).toEqual(
      [...AST_GREP_LANGUAGES].toSorted()
    );
  });

  it("lists Yaml, so a GitHub Actions workflow is an sg rule", () => {
    // The named case from taskless/cli#151: two Actions workflow rules were
    // routed to `runtime` — which needs a login — because nothing in the
    // recipe said ast-grep parses YAML. Asserted by name rather than left to
    // fall out of the set-equality above, so the answer to that issue cannot
    // regress into an implication nobody rereads.
    expect(reportedLanguages()).toContain("Yaml");
    expect(AST_GREP_LANGUAGES).toContain("Yaml");
  });

  it("spells languages the way a rule's `language:` field must", () => {
    // ast-grep's vocabulary is not `detect --json`'s: `detect` reports the
    // repository's languages as `C++`. These assertions are about the
    // canonical list, NOT about what the binary rejects — measured at 0.45.2,
    // `C++` and `cpp` are accepted aliases for Cpp. The recipe tells authors
    // to copy from this list because an unrecognized name (`C#`) aborts the
    // whole scan and a wrong-parser name reports nothing; see `the language
    // field` suite for the cases that pin those two failures.
    expect(AST_GREP_LANGUAGES).toContain("Cpp");
    expect(AST_GREP_LANGUAGES).not.toContain("C++");
    expect(AST_GREP_LANGUAGES).not.toContain("yaml");
  });

  it("renders the list as recipe prose with no gaps", () => {
    const rendered = astGrepLanguageList();
    for (const language of AST_GREP_LANGUAGES) {
      expect(rendered).toContain(language);
    }
    expect(rendered.split(", ")).toHaveLength(AST_GREP_LANGUAGES.length);
  });

  it("parses each AST_GREP_LANGUAGE_EXTENSIONS extension as its language by default", () => {
    // Depended on by: fixture-convert.ts naming a converted snippet
    // `<case>.<extension>`. ast-grep picks a file's parser from its extension
    // alone, so an extension that maps to another language (or to none)
    // leaves the converted fixture unparsed and every fail case quiet.
    //
    // One rule per language and one file per extension, in a single scan. Each
    // file must be reported by its own language's rule and by no other, read
    // off the `language` field ast-grep reports rather than inferred.
    const rules: Record<string, string> = {};
    const sources: Record<string, string> = {};
    for (const [language, extension] of Object.entries(
      AST_GREP_LANGUAGE_EXTENSIONS
    )) {
      // `pattern: zzz` parses in every grammar but Html's, where the text
      // node is the smallest thing to match.
      const matcher = language === "Html" ? "  kind: text" : "  pattern: zzz";
      rules[language.toLowerCase()] = [
        `id: ${language.toLowerCase()}`,
        `language: ${language}`,
        "severity: warning",
        "message: m",
        "rule:",
        matcher,
        "",
      ].join("\n");
      sources[`src/a.${extension}`] = "zzz\n";
    }

    const result = scan(project({ rules, sources }));
    expect(result.status, result.stderr).toBe(0);
    const reported = new Map<string, Set<string>>();
    for (const line of result.stdout.split("\n")) {
      if (line === "") continue;
      const match = JSON.parse(line) as {
        file: string;
        language: string;
        ruleId: string;
      };
      // The Yaml rule also reads the project's own rule files and config.
      if (!match.file.startsWith("src/")) continue;
      const seen = reported.get(match.file) ?? new Set<string>();
      seen.add(`${match.language}/${match.ruleId}`);
      reported.set(match.file, seen);
    }

    expect(
      Object.fromEntries([...reported].map(([file, seen]) => [file, [...seen]]))
    ).toEqual(
      Object.fromEntries(
        Object.entries(AST_GREP_LANGUAGE_EXTENSIONS).map(
          ([language, extension]) => [
            `src/a.${extension}`,
            [`${language}/${language.toLowerCase()}`],
          ]
        )
      )
    );
  });
});
