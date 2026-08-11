import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";

/**
 * Vale's observable behaviour, pinned.
 *
 * Everything here is a property of a **vendored third-party binary** that we
 * upgrade on Vale's cadence, not ours. `vale-run.test.ts` asserts that our code
 * behaves correctly *given* these; this file asserts the givens, so a Vale
 * upgrade that changes one fails here — naming the assumption and the code that
 * rests on it — instead of surfacing as a mysterious mapping bug.
 *
 * Each case says what breaks if it changes. That is the point of the file: a
 * red test here is a instruction to go change specific code, not a puzzle.
 *
 * These invoke Vale directly rather than through `runVale`, deliberately. A
 * test that went through our wrapper would be asserting our interpretation of
 * Vale, which is the thing under test everywhere else.
 */

const binary = findValeBinary().path;
const withVale = binary === undefined ? describe.skip : describe;

const workspaces: string[] = [];
afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function project(
  config: string,
  rules: Record<string, string>,
  documents: Record<string, string>
): string {
  const cwd = mkdtempSync(join(tmpdir(), "vale-contract-"));
  workspaces.push(cwd);
  mkdirSync(join(cwd, ".taskless", "vale", "rules"), { recursive: true });
  writeFileSync(join(cwd, ".taskless", "vale", ".vale.ini"), config);
  for (const [name, body] of Object.entries(rules)) {
    writeFileSync(join(cwd, ".taskless", "vale", "rules", `${name}.yml`), body);
  }
  for (const [path, body] of Object.entries(documents)) {
    writeFileSync(join(cwd, path), body);
  }
  return cwd;
}

/** Invoke Vale exactly as `runVale` does, but capture the raw streams. */
function runRaw(cwd: string, paths: string[], extraArguments: string[] = []) {
  return spawnSync(
    binary as string,
    [
      "--config",
      ".taskless/vale/.vale.ini",
      "--output=JSON",
      ...extraArguments,
      "--",
      ...paths,
    ],
    { cwd, encoding: "utf8" }
  );
}

const header = "StylesPath = .\nMinAlertLevel = suggestion\n";
const existence = (token: string, level = "warning") =>
  `extends: existence\nmessage: "Avoid '${token}'"\nlevel: ${level}\ntokens:\n  - ${token}\n`;

/** A project whose single document trips its single rule. */
const findingProject = (level = "warning") =>
  project(
    `${header}\n[*.md]\nrules.no-simply = YES\n`,
    { "no-simply": existence("simply", level) },
    { "doc.md": "Just simply do it.\n" }
  );

/** Exit status of a run at `level`, without `--no-exit`. */
const exitStatusAtLevel = (level: string) =>
  runRaw(findingProject(level), ["doc.md"]).status;

withVale("Vale vendor contract", () => {
  it("reports its own name in --version", () => {
    // Depended on by: PlatformBinarySpec.identity (/vale/i). If Vale stops
    // saying "vale" here, resolution rejects the real binary as a placeholder
    // and the engine silently reports unavailable.
    const result = spawnSync(binary as string, ["--version"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/vale/i);
  });

  describe("exit codes", () => {
    it("exits 0 with --no-exit despite findings", () => {
      // Depended on by: runVale treating any non-zero exit as Vale failing.
      // Without --no-exit Vale exits non-zero merely for finding something, and
      // every run with a finding would be reported as a failed engine.
      const result = runRaw(findingProject(), ["doc.md"], ["--no-exit"]);
      expect(result.status).toBe(0);
      expect(result.stdout).not.toBe("");
    });

    it("exits non-zero WITHOUT --no-exit only for error-level findings", () => {
      // Measured, and narrower than expected: Vale's exit code keys off
      // SEVERITY, not off having found something. suggestion and warning exit
      // 0 even without --no-exit; only error exits 1. So --no-exit is
      // load-bearing exactly for error-level rules, which is precisely where
      // dropping it would be most damaging — every check with a real violation
      // would be reported as a failed engine rather than as findings.
      expect(exitStatusAtLevel("suggestion")).toBe(0);
      expect(exitStatusAtLevel("warning")).toBe(0);
      expect(exitStatusAtLevel("error")).not.toBe(0);
    });
  });

  it("prints an empty JSON object when there are no findings", () => {
    // Depended on by: runVale parsing stdout and mapping `{}` to no results.
    // Measured — it is `{}`, not an empty stream, so the empty-stdout branch in
    // runVale is insurance rather than the live path. If Vale ever printed a
    // human-readable "no issues" line instead, JSON.parse would fail and a
    // clean run would be reported as a failure.
    const cwd = project(
      `${header}\n[*.md]\nrules.no-simply = YES\n`,
      { "no-simply": existence("simply") },
      { "doc.md": "Nothing objectionable.\n" }
    );
    const result = runRaw(cwd, ["doc.md"], ["--no-exit"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("{}");
  });

  it("keys findings by path, with the documented field names", () => {
    // Depended on by: the ValeFinding interface and toValeCheckResults, which
    // pushes the outer key down as `file`. A rename on any of these arrives as
    // `undefined` in a CheckResult rather than as an error.
    const cwd = project(
      `${header}\n[*.md]\nrules.no-simply = YES\n`,
      { "no-simply": existence("simply") },
      { "doc.md": "One\nTwo\nJust simply do it.\n" }
    );
    const result = runRaw(cwd, ["doc.md"], ["--no-exit"]);
    const parsed = JSON.parse(result.stdout) as Record<
      string,
      Array<Record<string, unknown>>
    >;

    expect(Object.keys(parsed)).toEqual(["doc.md"]);
    const finding = parsed["doc.md"]?.[0];
    expect(finding).toBeDefined();
    expect(Object.keys(finding ?? {}).toSorted()).toEqual([
      "Action",
      "Check",
      "Description",
      "Line",
      "Link",
      "Match",
      "Message",
      "Severity",
      "Span",
    ]);
  });

  it("prefixes check names with the StylesPath directory", () => {
    // Depended on by: stripRulesPrefix. The prefix is the *directory* name, so
    // it is `rules.` only because the engine layout puts styles in
    // `.taskless/vale/rules/`. If that directory is ever renamed, the strip
    // must be renamed with it.
    const cwd = project(
      `${header}\n[*.md]\nrules.no-simply = YES\n`,
      { "no-simply": existence("simply") },
      { "doc.md": "Just simply do it.\n" }
    );
    const parsed = JSON.parse(
      runRaw(cwd, ["doc.md"], ["--no-exit"]).stdout
    ) as Record<string, Array<{ Check: string }>>;
    expect(parsed["doc.md"]?.[0]?.Check).toBe("rules.no-simply");
  });

  it("reports Span as 1-based inclusive columns on a single line", () => {
    // Depended on by: toValeCheckResult building `range` from Line + Span, with
    // start and end sharing the line. "Just simply do it." puts `simply` at
    // columns 6-11.
    const cwd = project(
      `${header}\n[*.md]\nrules.no-simply = YES\n`,
      { "no-simply": existence("simply") },
      { "doc.md": "Just simply do it.\n" }
    );
    const parsed = JSON.parse(
      runRaw(cwd, ["doc.md"], ["--no-exit"]).stdout
    ) as Record<string, Array<{ Line: number; Span: [number, number] }>>;
    const finding = parsed["doc.md"]?.[0];
    expect(finding?.Line).toBe(1);
    expect(finding?.Span).toEqual([6, 11]);
  });

  it("accepts exactly [suggestion warning error] as levels", () => {
    // Depended on by: normalizeSeverity. Its default branch is future-proofing
    // *because* of this — Vale refuses anything outside the vocabulary, so a
    // fourth level cannot reach us until Vale adds one. If this test fails
    // because Vale gained a level, normalizeSeverity needs a real case for it.
    const cwd = project(
      `${header}\n[*.md]\nrules.bogus = YES\n`,
      { bogus: existence("simply", "catastrophe") },
      { "doc.md": "Just simply do it.\n" }
    );
    const result = runRaw(cwd, ["doc.md"], ["--no-exit"]);
    expect(result.stderr).toContain(
      "must be one of [suggestion warning error]"
    );
  });

  it("emits each accepted level verbatim in Severity", () => {
    for (const level of ["suggestion", "warning", "error"]) {
      const cwd = project(
        `${header}\n[*.md]\nrules.lvl = YES\n`,
        { lvl: existence("simply", level) },
        { "doc.md": "Just simply do it.\n" }
      );
      const parsed = JSON.parse(
        runRaw(cwd, ["doc.md"], ["--no-exit"]).stdout
      ) as Record<string, Array<{ Severity: string }>>;
      expect(parsed["doc.md"]?.[0]?.Severity).toBe(level);
    }
  });

  it("sends a config error to stderr with a non-zero exit", () => {
    // Depended on by: runVale's non-zero-exit branch reporting `failed`. This
    // is the measured behaviour — an earlier reading of "exit 0 on stdout" was
    // an artifact of piping through `head` with 2>&1. If Vale ever moves this
    // to stdout with exit 0, the asValeConfigError guard in map.ts becomes
    // load-bearing rather than defensive.
    const cwd = project(
      `${header}\n[*.md]\nrules.bogus = YES\n`,
      { bogus: existence("simply", "catastrophe") },
      { "doc.md": "Just simply do it.\n" }
    );
    const result = runRaw(cwd, ["doc.md"], ["--no-exit"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).toBe("");
    const parsed = JSON.parse(result.stderr) as { Code?: string };
    expect(parsed.Code).toBe("E201");
  });

  describe("matcher semantics", () => {
    const rules = {
      "no-simply": existence("simply"),
      "no-very": existence("very"),
    };

    it("unions duplicate matchers rather than last-one-wins", () => {
      // Depended on by: the spec's "duplicate matchers merge" requirement. If
      // Vale switched to last-one-wins, a rule scoped across two matchers would
      // silently stop running.
      const cwd = project(
        `${header}\n[*.md]\nrules.no-simply = YES\n\n[*.md]\nrules.no-very = YES\n`,
        rules,
        { "doc.md": "Just simply do it, very quickly.\n" }
      );
      const parsed = JSON.parse(
        runRaw(cwd, ["doc.md"], ["--no-exit"]).stdout
      ) as Record<string, Array<{ Check: string }>>;
      expect(
        (parsed["doc.md"] ?? []).map((finding) => finding.Check).toSorted()
      ).toEqual(["rules.no-simply", "rules.no-very"]);
    });

    /** `{}` means the rule did not run for that file. */
    const ran = (config: string, paths: string[] = ["doc.md"]) =>
      runRaw(
        project(config, rules, {
          "doc.md": "Just simply do it.\n",
        }),
        paths,
        ["--no-exit"]
      ).stdout.trim() !== "{}";

    it("gives a LATER matcher precedence over an earlier one", () => {
      // The spec originally claimed a disable wins "independent of order".
      // Measured against 3.17.1 that is false in both directions, and the
      // spec has been corrected to match. Both orders are asserted here,
      // because checking only the convenient one is exactly how the wrong
      // claim survived: a test named "regardless of order" passed while
      // exercising a single order.
      expect(
        ran(
          `${header}\n[*.md]\nrules.no-simply = YES\n\n[doc.md]\nrules.no-simply = NO\n`
        )
      ).toBe(false);
      expect(
        ran(
          `${header}\n[doc.md]\nrules.no-simply = NO\n\n[*.md]\nrules.no-simply = YES\n`
        )
      ).toBe(true);
    });

    it("keeps the FIRST assignment when one matcher sets a key twice", () => {
      // Duplicate `[glob]` sections are merged, and the merge discards the
      // later value — the opposite of the across-matcher rule above. Tooling
      // that appends a disable to an existing matcher would therefore write a
      // line Vale ignores.
      expect(
        ran(
          `${header}\n[*.md]\nrules.no-simply = YES\n\n[*.md]\nrules.no-simply = NO\n`
        )
      ).toBe(true);
      expect(
        ran(
          `${header}\n[*.md]\nrules.no-simply = NO\n\n[*.md]\nrules.no-simply = YES\n`
        )
      ).toBe(false);
    });
  });

  it("matches existence tokens case-sensitively by default", () => {
    // Depended on by: every fixture we author, and by anyone writing a rule.
    // `Simply` does not match the token `simply`. This cost real time once —
    // a verify fixture that read as a bug in the verifier rather than as a
    // fixture that never matched. If Vale ever changes this default, rules
    // that relied on case sensitivity start firing on prose they ignored.
    const cwd = project(
      `${header}\n[*.md]\nrules.no-simply = YES\n`,
      { "no-simply": existence("simply") },
      { "doc.md": "Simply put, simply.\n" }
    );
    const parsed = JSON.parse(
      runRaw(cwd, ["doc.md"], ["--no-exit"]).stdout
    ) as Record<string, Array<{ Span: [number, number] }>>;
    // One finding: the lowercase occurrence only.
    expect(parsed["doc.md"]).toHaveLength(1);
  });

  it("ignores a `tskl)` breadcrumb key in the config", () => {
    // Depended on by: the spec's breadcrumb requirement — Taskless writes
    // `tskl) rule = <id>` keys into .vale.ini and relies on Vale's ini parser
    // accepting and ignoring them. If Vale ever validates unknown keys, every
    // committed config becomes unreadable at once.
    const cwd = project(
      `${header}\n[*.md]\ntskl) rule = no-simply\nrules.no-simply = YES\n`,
      { "no-simply": existence("simply") },
      { "doc.md": "Just simply do it.\n" }
    );
    const result = runRaw(cwd, ["doc.md"], ["--no-exit"]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown[]>;
    expect(parsed["doc.md"]).toHaveLength(1);
  });
});
