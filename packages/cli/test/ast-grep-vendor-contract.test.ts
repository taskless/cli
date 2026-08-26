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
import { ruleDirectory, ruleTestsDirectory } from "../src/rules/engines";
import {
  buildPath,
  findSgBinary,
  stripSgDeprecationBanner,
} from "../src/rules/scan";

/**
 * ast-grep's observable behaviour, pinned.
 *
 * Everything here is a property of a **vendored third-party binary**, exact-
 * pinned at `0.45.2` in `packages/cli/package.json`. Our own tests assert that
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
 * rather than through `runAstGrepScan` or `runTests`, deliberately: a test that
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

/** Valid test YAML, and invalid *rule* YAML — it carries no `language`. */
const testFile = (id: string, invalid: string[], valid: string[] = []) =>
  [
    `id: ${id}`,
    "valid:",
    ...valid.map((source) => `  - ${JSON.stringify(source)}`),
    "invalid:",
    ...invalid.map((source) => `  - ${JSON.stringify(source)}`),
    "",
  ].join("\n");

interface Project {
  /** Rule id to rule YAML. Each becomes `rules/<id>/<id>.yml`. */
  rules: Record<string, string>;
  /** Rule id to test YAML, written to `rules/<id>/.tests/<id>-test.yml`. */
  tests?: Record<string, string>;
  /** Path relative to the project root, to file contents. */
  sources?: Record<string, string>;
}

/**
 * A throwaway ast-grep project.
 *
 * The `sgconfig.yml` is written literally rather than through
 * `assembleSgConfig`, so what is pinned is the binary's response to a config,
 * not our assembler's idea of one. The two relocated discovery cases at the
 * bottom of this file are the deliberate exception: there, our layout is the
 * thing being checked against discovery.
 */
function project({ rules, tests = {}, sources = {} }: Project): string {
  const cwd = mkdtempSync(join(tmpdir(), "sg-contract-"));
  workspaces.push(cwd);

  for (const [id, body] of Object.entries(rules)) {
    mkdirSync(join(cwd, "rules", id), { recursive: true });
    writeFileSync(join(cwd, "rules", id, `${id}.yml`), body);
  }
  for (const [id, body] of Object.entries(tests)) {
    mkdirSync(join(cwd, "rules", id, ".tests"), { recursive: true });
    writeFileSync(join(cwd, "rules", id, ".tests", `${id}-test.yml`), body);
  }
  for (const [path, body] of Object.entries(sources)) {
    // The parent of the path actually given, not a hardcoded `src/` — every
    // case today happens to live under `src/`, and a future one that does not
    // should not fail with ENOENT.
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), body);
  }

  writeFileSync(
    join(cwd, "sgconfig.yml"),
    [
      "ruleDirs:",
      "  - rules",
      "testConfigs:",
      ...Object.keys(tests).map((id) => `  - testDir: rules/${id}/.tests`),
      "",
    ].join("\n")
  );
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

/** `test`, exactly as `runTests` invokes it. */
const test = (cwd: string, ruleId: string) =>
  run(cwd, [
    "test",
    "-c",
    "sgconfig.yml",
    "--skip-snapshot-tests",
    "--filter",
    `^${ruleId}$`,
  ]);

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

/** The call each finding matched, in file order — i.e. the arities accepted. */
const arityMatches = (body: string): string[] =>
  scan(project({ rules: { arity: arityRule(body) }, sources: aritySource }))
    .stdout.split("\n")
    .filter((line) => line !== "")
    .map((line) => (JSON.parse(line) as { text: string }).text);

/** A rule whose fixtures all pass. */
const passingProject = () =>
  project({
    rules: { "no-eval": rule("no-eval") },
    tests: { "no-eval": testFile("no-eval", ["eval(x)"], ["const a = 1"]) },
  });

/**
 * A failing case whose fixture text reads like a summary line. This is the
 * poisoning case from issue #112, kept here as the fixture that makes the echo
 * behaviour concrete.
 */
const failingProject = () =>
  project({
    rules: { "no-eval": rule("no-eval") },
    tests: {
      "no-eval": testFile("no-eval", ["const msg = '7 passed; 0 failed';"]),
    },
  });

withSg("ast-grep vendor contract", () => {
  it("reports its own name in --version", () => {
    // Depended on by: AST_GREP_BINARY.identity (/ast-grep/i) in scan.ts. The
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
      const cwd = project({
        rules: { "no-eval": rule("no-eval", "catastrophe") },
        sources: evalSource,
      });
      const result = scan(cwd);
      expect(result.stderr).toContain(
        "unknown variant `catastrophe`, expected one of `hint`, `info`, `warning`, `error`, `off`"
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
  });

  describe("sg test", () => {
    it("prints `test result: ok. N passed; M failed;` to stdout and exits 0", () => {
      // Depended on by: parseTestSummary in verify.ts, which anchors on this
      // exact wording, and by runTests keying validity off exit 0. If the
      // wording changes, the counts read 0/0 and verify falls through to the
      // exit-code snippet — degraded rather than wrong, and this test is what
      // announces it.
      const result = test(passingProject(), "no-eval");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("test result:");
      expect(result.stdout).toMatch(
        /test result: .*ok.*\. 1 passed; 0 failed;/
      );
    });

    it("prints `Error: test failed. N passed; M failed;` to stderr and exits 4", () => {
      // The failure summary lands on STDERR, not stdout, which is why verify
      // scans both streams. The exit code is 4 — not 1 — and runTests treats
      // any non-zero as failure, so nothing depends on the number today; it is
      // pinned because a future 0-on-failure would read as a pass.
      const outcome = test(failingProject(), "no-eval");
      expect(outcome.status).toBe(4);
      expect(outcome.stderr).toMatch(
        /Error: test failed\. 0 passed; 1 failed;/
      );
    });

    it("no longer colorizes the summary when stdout is not a TTY", () => {
      // CHANGED AT 0.45.2. At 0.41.0 the summary arrived colorized even
      // through a pipe, and this test pinned that. `--color` now honours its
      // `auto` default, so a piped run is plain text.
      // eslint-disable-next-line no-control-regex -- the escape IS the subject
      const greenOk = /\u001B\[32mok\u001B\[0m/;
      expect(test(passingProject(), "no-eval").stdout).not.toMatch(greenOk);
    });

    it("still puts the escape INSIDE the phrase under --color always", () => {
      // Depended on by: parseTestSummary stripping VT control characters
      // before matching, in verify.ts. Colour is gone from the piped default
      // above, but it returns whenever stdout IS a TTY, and the escape lands
      // between `test result: ` and `ok`, i.e. inside the phrase being
      // anchored on. A parser that dropped the stripping would therefore keep
      // working under CI and fail interactively, which is the worst place to
      // find out. `--color always` is the testable stand-in for a TTY.
      const colorized = run(passingProject(), [
        "test",
        "-c",
        "sgconfig.yml",
        "--skip-snapshot-tests",
        "--color",
        "always",
        "--filter",
        "^no-eval$",
      ]);
      // eslint-disable-next-line no-control-regex -- the escape IS the subject
      expect(colorized.stdout).toMatch(
        /test result: \u001B\[32mok\u001B\[0m\./
      );
    });

    it("echoes the offending source on failure, and nothing on success", () => {
      // This is the root of #112: fixture text is reproduced verbatim into the
      // output of a failing run, so an unanchored `/(\d+)\s+passed/` can match
      // the fixture instead of the summary. A passing run echoes nothing, which
      // is why the old parser was only ever wrong on failures.
      expect(test(failingProject(), "no-eval").stdout).toContain(
        "const msg = '7 passed; 0 failed';"
      );
      expect(test(passingProject(), "no-eval").stdout).not.toContain(
        "const a = 1"
      );
    });

    it("indents every echoed line, so fixture text never reaches column 0", () => {
      // Depended on by: parseTestSummary anchoring on `^`. This is what makes
      // the anchor close the *class* rather than the one fixture in #112 — a
      // fixture whose own text is a verbatim summary line is still echoed
      // indented, so it cannot be mistaken for the summary. Multi-line, since
      // the indent has to hold for continuation lines too.
      const poison = "Error: test failed. 99 passed; 0 failed;";
      const cwd = project({
        rules: { "no-eval": rule("no-eval") },
        tests: {
          "no-eval": testFile("no-eval", [
            `const a = 1;\n${poison}\nlet b = 2;`,
          ]),
        },
      });
      const { stdout } = test(cwd, "no-eval");

      expect(stdout).toContain(`  ${poison}`);
      expect(stdout).not.toMatch(
        new RegExp(
          `^${poison.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}`,
          "m"
        )
      );
    });

    it("needs --skip-snapshot-tests for an invalid case with no baseline", () => {
      // Depended on by: runTests passing the flag. Without it, every invalid
      // case in a rule that has never had snapshots recorded fails with "No
      // baseline found" — a rule that is correct reported as failing.
      const cwd = passingProject();
      const withoutFlag = run(cwd, [
        "test",
        "-c",
        "sgconfig.yml",
        "--filter",
        "^no-eval$",
      ]);
      expect(withoutFlag.status).not.toBe(0);
      expect(withoutFlag.stdout).toContain("baseline found");
    });

    it("treats --filter as an unanchored regex", () => {
      // Depended on by: runTests building `^${escapeRegExp(ruleId)}$`. The
      // anchors are load-bearing — without them, verifying `no-eval` would also
      // run `no-eval-strict`'s cases and report its failures against the wrong
      // rule.
      const cwd = project({
        rules: {
          "no-eval": rule("no-eval"),
          "no-eval-strict": rule("no-eval-strict"),
        },
        tests: {
          "no-eval": testFile("no-eval", ["eval(x)"]),
          "no-eval-strict": testFile("no-eval-strict", ["eval(x)"]),
        },
      });
      const anchored = run(cwd, [
        "test",
        "-c",
        "sgconfig.yml",
        "--skip-snapshot-tests",
        "--filter",
        "^no-eval$",
      ]);
      expect(anchored.stdout).toContain("1 passed; 0 failed;");

      const unanchored = run(cwd, [
        "test",
        "-c",
        "sgconfig.yml",
        "--skip-snapshot-tests",
        "--filter",
        "no-eval",
      ]);
      expect(unanchored.stdout).toContain("2 passed; 0 failed;");
    });
  });

  /**
   * How a wrong `language:` fails — the two shapes `route.txt` warns about.
   *
   * Nothing of ours catches either one first: the vendored
   * `src/generated/ast-grep-rule-schema.json` types `$defs.Language` as a bare
   * string with no enum, and `verify` never reads the field. So the binary's
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
      // `verify` compares lowercased (see `resolveAstGrepLanguage`), which is
      // only safe because the binary does too. If a bump ever made one name
      // case-sensitive, `verify` would start passing a rule ast-grep refuses.
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
      // leaves `verify` failing a rule that now works. These are the spellings
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
   * ast-grep exposes only the block tree. `route.txt` and `create-sg-rule.txt`
   * both make that claim in prose; these are the measurements behind it, so
   * the recipes cannot drift from the binary silently.
   *
   * The failure this prevents is the #152 shape in a new place: a rule that
   * reads as structural, is accepted, and matches nothing forever.
   */
  describe("Markdown sees blocks, not inline constructs", () => {
    /** A document with a heading, a subheading, a list, a fence and a link. */
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

    it("matches block-level kinds", () => {
      expect(matchCount("  kind: atx_heading")).toBe(2);
      expect(matchCount("  kind: fenced_code_block")).toBe(1);
      expect(matchCount("  kind: list_item")).toBe(2);
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

  describe("the `sg` alias prints a deprecation banner on stderr", () => {
    // DEPRECATED AT 0.45.0. `AST_GREP_BINARY.binaryNames` puts `ast-grep`
    // first, but the resolver reverses that list at its link-based tiers, so
    // on a host where only `sg` got linked every run carries this banner.
    // Both `runAstGrepScan` and `verify` decode ast-grep's stderr into
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

  describe("the .tests/ directory is invisible to rule discovery", () => {
    const RULE = rule("no-eval");
    const TEST_FILE = testFile("no-eval", ["eval(x)"], ["const a = 1"]);

    /** A throwaway root carrying our committed rule layout. */
    function layout(): { cwd: string; directory: string } {
      const cwd = mkdtempSync(join(tmpdir(), "sg-contract-layout-"));
      workspaces.push(cwd);
      const directory = ruleDirectory(cwd, "sg", "no-eval");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "no-eval.yml"), RULE);
      return { cwd, directory };
    }

    it("scans clean with test YAML inside a rule's .tests/", async () => {
      const { cwd } = layout();
      const tests = ruleTestsDirectory(cwd, "sg", "no-eval");
      mkdirSync(tests, { recursive: true });
      writeFileSync(join(tests, "no-eval-20260101-test.yml"), TEST_FILE);
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(join(cwd, "src", "a.ts"), 'const x = eval("1");\n');

      const configPath = await assembleSgConfig(cwd);
      expect(configPath).toBeDefined();

      // The rule fires — exit 1, error severity — which proves discovery ran;
      // the test file beneath it was never parsed as a rule, which is the
      // property being pinned. A parse failure produces no JSON at all.
      const result = scan(cwd, configPath ?? "");
      expect(result.status).toBe(1);
      const findings = result.stdout
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as { ruleId: string });
      expect(findings.map((finding) => finding.ruleId)).toEqual(["no-eval"]);
    });

    it("fails the whole scan if the same file sits in a non-dot directory", async () => {
      // Deliberately NOT `.tests/` — this is the layout the dot exists to
      // avoid. A test file is invalid rule YAML: it has no `language`.
      const { cwd, directory } = layout();
      mkdirSync(join(directory, "tests"), { recursive: true });
      writeFileSync(
        join(directory, "tests", "no-eval-20260101-test.yml"),
        TEST_FILE
      );

      const configPath = await assembleSgConfig(cwd);
      const result = scan(cwd, configPath ?? "");
      expect(result.status).toBeGreaterThan(1);
      expect(result.stderr).toContain("missing field `language`");
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
 * instead of prose inside `route.txt` — transcribed prose in a `.txt` has
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
 * `verify` does validate a rule's `language` — against `AST_GREP_LANGUAGES` and
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
    // AST_GREP_VERSION is what route.txt renders next to the language list, so
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
});
