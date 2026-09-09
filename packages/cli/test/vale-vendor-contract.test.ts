import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";
import { asValeConfigError } from "../src/rules/vale/map";
import {
  VALE_COMMENT_EXTENSIONS,
  VALE_CONVERTER_CHECKERS,
  VALE_CONVERTER_DEPENDENT,
  VALE_CONVERTER_DEPENDENT_EXTENSIONS,
  VALE_FORMAT_TIERS,
  VALE_MARKUP_EXTENSIONS,
  VALE_PLAINTEXT_EXTENSIONS,
  VALE_VERSION,
  valeCommentList,
  valeConverterList,
  valeMarkupList,
  valePlaintextList,
} from "../src/rules/capabilities";
import { VALE_CHECK_TYPES } from "../src/schemas/vale-rule";

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

/**
 * Findings in `doc.md` for one rule, enabled as `rules.no-hedging`.
 *
 * The id avoids the token the rules below look for, deliberately: at `raw`
 * scope a directive line is itself linted text, so a rule named `no-simply`
 * that looks for `simply` reports a finding on the marker silencing it.
 */
const hedgingFindings = (rule: string, document: string) => {
  const cwd = project(
    `${header}\n[*.md]\nrules.no-hedging = YES\n`,
    { "no-hedging": rule },
    { "doc.md": document }
  );
  const parsed = JSON.parse(
    runRaw(cwd, ["doc.md"], ["--no-exit"]).stdout
  ) as Record<string, unknown[]>;
  return parsed["doc.md"]?.length ?? 0;
};

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

  it("reports a config error's Path relative for a target file, absolute for a rule", () => {
    // Depended on by: `targetFileParseError` in run.ts, which uses exactly this
    // distinction to tell "one unreadable TARGET file, exclude it and retry"
    // from "our own rule config is broken, stop". That is the whole mechanism
    // behind taskless/cli#300, and it rests on Vale's choice of path shape
    // rather than on anything this repository controls.
    //
    // Pinned HERE, in the vendor contract, and not only through run.ts's
    // behaviour tests, because of what each one says when it breaks. If Vale
    // starts reporting target files absolutely, run.ts's tests fail with
    // "expected ok to be failed" and someone has to work backwards to the
    // cause. This one names it. The upgrade procedure re-probes this file on
    // every bump, which is the moment the answer can change.
    //
    // The failure direction is the safe one either way: an unrecognised target
    // error stops the run rather than excluding a rule config and continuing,
    // so a change here degrades #300 back to its old behaviour rather than
    // silently checking nothing. Loud, not silent, but still wrong.

    // A target file Vale cannot parse: unquoted colon in its front matter.
    const targetCwd = project(
      `${header}\n[*.md]\nrules.lvl = YES\n`,
      { lvl: existence("simply") },
      {
        "doc.md":
          "---\ndescription: has a colon: right here\n---\n\nJust simply do it.\n",
      }
    );
    const targetError = JSON.parse(
      runRaw(targetCwd, ["doc.md"], ["--no-exit"]).stderr
    ) as { Path?: string };
    expect(targetError.Path).toBe("doc.md");
    expect(isAbsolute(targetError.Path ?? "")).toBe(false);

    // A rule file Vale cannot load, reached through StylesPath rather than
    // named on the command line.
    const ruleCwd = project(
      `${header}\n[*.md]\nrules.bogus = YES\n`,
      { bogus: existence("simply", "catastrophe") },
      { "doc.md": "Just simply do it.\n" }
    );
    const ruleError = JSON.parse(
      runRaw(ruleCwd, ["doc.md"], ["--no-exit"]).stderr
    ) as { Path?: string };
    expect(isAbsolute(ruleError.Path ?? "")).toBe(true);
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

  describe("comment directives", () => {
    // A directive pair at a list item's continuation indent, with no blank
    // line separating it from the prose it wraps. Both halves matter: the
    // indent is what fails CommonMark's HTML-block test, and the absence of a
    // blank line is what leaves the directive inline INSIDE the paragraph.
    //
    // SIX SPACES UNDER A `- ` BULLET IS FOUR PAST THE CONTENT COLUMN, WHICH IS
    // THE INDENTED-CODE THRESHOLD, AND IT IS STILL A PARAGRAPH. An indented
    // code block cannot interrupt a paragraph, so with no blank line these are
    // lazy continuation lines however deep they sit. Measured, same rule and
    // same indent: no blank line reports 2, and inserting one before each line
    // reports 0 because the content is then a code block and code is not
    // prose. `unzoned` asserting 2 below is what holds that distinction in
    // place — a fixture that had drifted into a code block would report 0, and
    // the zoned assertion of 1 could not then pass either.
    const zoned = [
      "- **A bullet.** Some lead-in text here.",
      "      <!-- vale rules.no-hedging = NO -->",
      "      A sentence that simply hedges inside the zone.",
      "      <!-- vale rules.no-hedging = YES -->",
      "      A sentence that simply hedges after the zone.",
      "",
    ].join("\n");
    const unzoned = zoned.replaceAll(/^ *<!-- vale.*\n/gm, "");

    const rawRule =
      "extends: existence\nmessage: \"Avoid 'simply'\"\nlevel: warning\n" +
      "scope: raw\ntokens:\n  - simply\n";

    it("honors a directive at a continuation indent", () => {
      // Depended on by: the exception-zone guidance in `create-vale-rule`,
      // which tells an author where a zone may go and what it costs.
      //
      // NEW IN 3.20.0, AND THE OLD BEHAVIOUR WAS SILENT. Through 3.19.0 an
      // inline pair was read once per block, so the NO and the YES cancelled
      // out before the paragraph was linted and the zone did nothing at all —
      // no error, no warning, the words still reported. Measured: 3.19.0
      // reports both sentences here, 3.20.0 only the one after the YES.
      //
      // If this regresses, the recipe is teaching a zone that silently does
      // not apply, which is worse than teaching that zones are unavailable.
      expect(hedgingFindings(existence("simply"), unzoned)).toBe(2);
      expect(hedgingFindings(existence("simply"), zoned)).toBe(1);
    });

    it("honors a directive for a `scope: raw` rule", () => {
      // Depended on by: the same guidance, which until 3.20.0 had to say that
      // choosing `raw` gave up case-by-case exemption entirely.
      //
      // `raw` rules run after ResetComments and never saw a directive before
      // 3.20.0, which records the region each directive covers and suppresses
      // a located alert inside one. Measured on this document: 3.19.0 reports
      // both sentences, 3.20.0 one.
      //
      // THE RULE IS NAMED `no-hedging` RATHER THAN `no-simply` ON PURPOSE. At
      // `raw` scope the directive line is itself linted text, so a rule whose
      // token appears in its own name matches the `<!-- vale rules.no-simply
      // ... -->` line and reports a finding on the directive that silences it.
      expect(hedgingFindings(rawRule, unzoned)).toBe(2);
      expect(hedgingFindings(rawRule, zoned)).toBe(1);
    });
  });
});

/**
 * The reach `src/rules/capabilities.ts` publishes, pinned by probe.
 *
 * A separate top-level block from the contract suite above, because it asserts
 * something different: those cases pin how Vale behaves when we drive it, these
 * pin a constant we transcribed *from* it.
 *
 * PROBE-MEASURED, BECAUSE VALE SELF-REPORTS NOTHING. There is no `--list-formats`
 * and no capability listing anywhere in the binary, so the only way to know
 * which tier an extension lands in is to lint a file and look at what came
 * back. Each tier therefore has its own discriminating fixture rather than a
 * shared one — on ordinary prose all three tiers are indistinguishable, which
 * is exactly how a wrong claim would survive a lazier test:
 *
 * - **markup** is separated from plaintext by a construct only a real parser
 *   skips (a fenced code block, an Org `#` line, an HTML comment).
 * - **comment-only** is separated from plaintext by the NEGATIVE — the same
 *   token on a bare non-comment line must yield nothing. A file type that fires
 *   on both is the plaintext fallback wearing a code extension.
 * - **plaintext** is the tier that needs no separating — a bare line fires —
 *   but the entries listed in it do: each names a construct a parser WOULD have
 *   skipped, and the probe asserts Vale lints it. That is the assertion that
 *   `.tex`, `.mkd` and `.mkdn` are not markup, and it is the one the first
 *   hand-written table got backwards. It is also the assertion that expires: on
 *   3.17.1 `.rmd` belonged here, and 3.18.0 gave it a real parser and moved it
 *   into MARKUP_FIXTURES.
 * - **converter-dependent** is separated from everything by failing.
 *
 * See taskless/cli#151.
 */
/** The comment syntax Vale must see through, per extension. */
/**
 * A correct comment for `extension`, which is the whole difficulty of this
 * file: a wrong delimiter reads exactly like absent support. `.css` looks
 * unsupported if fed `//` and is comment-aware with a block comment; `.pod` is
 * linted as Perl, so a `#` comment fires while a `=head1` POD block does not.
 */
function comment(extension: string): string {
  const HASH = new Set([
    ".ex",
    ".exs",
    ".jl",
    ".pl",
    ".pm",
    ".ps1",
    ".pod",
    ".py",
    ".py3",
    ".pyw",
    ".r",
    ".R",
    ".rb",
  ]);
  if (HASH.has(extension)) return "# simply\n";
  if (extension === ".css") return "/* simply */\n";
  // Vale 3.18.0 parses PHP with tree-sitter, so a comment only counts inside
  // real PHP — on 3.17.1 a bare `// simply` was linted without the open tag.
  if (extension === ".php") return "<?php\n// simply\n";
  // QDoc documentation lives in a `/*! */` block, not an ordinary comment.
  if (extension === ".qdoc") return "/*!\n    simply\n*/\n";
  if (extension === ".hs" || extension === ".lua") return "-- simply\n";
  if (extension === ".clj") return "; simply\n";
  return "// simply\n";
}

withVale("Vale engine capabilities", () => {
  /** A project whose single rule applies to every extension. */
  const anyExtension = (documents: Record<string, string>) =>
    project(
      `${header}\n[*]\nrules.no-simply = YES\n`,
      { "no-simply": existence("simply") },
      documents
    );

  /** Findings Vale reports for one document, under `--no-exit`. */
  function findings(name: string, body: string): unknown[] {
    const cwd = anyExtension({ [name]: body });
    const result = runRaw(cwd, [name], ["--no-exit"]);
    expect(result.status, `${name}: ${result.stderr}`).toBe(0);
    const parsed = JSON.parse(result.stdout || "{}") as Record<
      string,
      unknown[]
    >;
    return parsed[name] ?? [];
  }

  /**
   * Prose Vale must find in a markup document, plus a construct it must skip.
   * The second half is the whole test: without it, `.md` and `.zzz` behave
   * identically and the markup tier asserts nothing.
   */
  const MARKUP_FIXTURES: Record<string, { prose: string; skipped: string }> = {
    ".md": {
      prose: "We simply do it.\n",
      skipped: "Fine.\n\n```\nsimply\n```\n",
    },
    ".markdown": {
      prose: "We simply do it.\n",
      skipped: "Fine.\n\n```\nsimply\n```\n",
    },
    ".mdown": {
      prose: "We simply do it.\n",
      skipped: "Fine.\n\n```\nsimply\n```\n",
    },
    ".org": { prose: "We simply do it.\n", skipped: "# simply\nFine.\n" },
    // Native as of 3.18.0. `.mdx` arrived from the converter tier, `.rmd` from
    // plaintext, and `.qmd` and `.myst` are new rows — four new claims, none of
    // them carried over from the 3.17.1 table.
    ".mdx": {
      prose: "We simply do it.\n",
      skipped: "Fine.\n\n```\nsimply\n```\n",
    },
    ".myst": {
      prose: "We simply do it.\n",
      skipped: "Fine.\n\n```\nsimply\n```\n",
    },
    ".qmd": {
      prose: "We simply do it.\n",
      skipped: "Fine.\n\n```{r}\nsimply <- 1\n```\n",
    },
    ".rmd": {
      prose: "We simply do it.\n",
      skipped: "Fine.\n\n```{r}\nsimply <- 1\n```\n",
    },
    ".htm": {
      prose: "<p>We simply do it.</p>\n",
      skipped: "<!-- simply -->\n",
    },
    ".html": {
      prose: "<p>We simply do it.</p>\n",
      skipped: "<!-- simply -->\n",
    },
    ".xhtml": {
      prose: "<p>We simply do it.</p>\n",
      skipped: "<!-- simply -->\n",
    },
  };

  it("reports the pinned version", () => {
    // VALE_VERSION is rendered beside the reach lists in route.md and
    // create-vale-rule.md, so it is the attribution for every claim below.
    // 3.18.0 moved rows in both directions: `.mdx` gained a native parser and
    // left the converter tier, while `.typ` gained a `typst2vast` converter and
    // entered it. A bump re-measures the whole table — the fixtures below are
    // the record of the last time that was done, not a forecast of the next.
    const result = spawnSync(binary as string, ["--version"], {
      encoding: "utf8",
    });
    expect(result.stdout.trim()).toBe(`vale version ${VALE_VERSION}`);
  });

  it("probes every row of VALE_FORMAT_TIERS", () => {
    // The table is the claim and this is its coverage check: every extension in
    // it is reached by one of the tier suites below, so a row cannot be added
    // without being measured. Reconciling two independently written tables
    // turned up six rows that disagreed, every one of them in a tier nothing
    // probed.
    const probed = [
      ...VALE_MARKUP_EXTENSIONS,
      ...VALE_COMMENT_EXTENSIONS,
      ...VALE_PLAINTEXT_EXTENSIONS,
      ...VALE_CONVERTER_DEPENDENT.flatMap(({ extensions }) => extensions),
    ].toSorted();
    expect(probed).toEqual(Object.keys(VALE_FORMAT_TIERS).toSorted());
  });

  it("covers every markup extension in VALE_MARKUP_EXTENSIONS", () => {
    // A fixture missing here would let an extension be added to the constant
    // without ever being probed, which is the drift the constant exists to
    // prevent.
    expect(Object.keys(MARKUP_FIXTURES).toSorted()).toEqual(
      [...VALE_MARKUP_EXTENSIONS].toSorted()
    );
  });

  it.each([...VALE_MARKUP_EXTENSIONS])(
    "parses %s as markup: prose is linted, the format's own syntax is not",
    (extension) => {
      const fixture = MARKUP_FIXTURES[extension]!;
      expect(findings(`doc${extension}`, fixture.prose)).toHaveLength(1);
      expect(
        findings(`skip${extension}`, fixture.skipped),
        `${extension} linted a construct a real parser would skip — it is the plaintext fallback, not markup`
      ).toHaveLength(0);
    }
  );

  it.each([...VALE_COMMENT_EXTENSIONS])(
    "lints comment text but not the code body in %s",
    (extension) => {
      expect(
        findings(`c${extension}`, comment(extension)),
        `${extension} did not lint its comment text`
      ).toHaveLength(1);
      expect(
        findings(`b${extension}`, "simply\n"),
        `${extension} linted a bare non-comment line — it is the plaintext fallback, not comment-aware`
      ).toHaveLength(0);
    }
  );

  /**
   * For each listed plaintext extension, the construct a parser for the format
   * its spelling suggests would have skipped.
   *
   * Vale lints it, which is the whole finding: `.tex` is not TeX to Vale and
   * `.mkd` is not Markdown. The mirror image of the markup fixtures — same
   * documents, opposite expectation.
   */
  const PLAINTEXT_FIXTURES: Record<string, string> = {
    ".mkd": "Fine.\n\n```\nsimply\n```\n",
    ".mkdn": "Fine.\n\n```\nsimply\n```\n",
    ".tex": "% simply in a comment\nFine.\n",
    // Documented by Vale as comment-aware, measured as plaintext on the pinned
    // binary — the construct here is the comment a parser would have skipped.
    // `.qml` and `.scss` were here until 3.18.0 gave them real parsers, and
    // `.rmd` left for MARKUP_FIXTURES in the same bump, which is why the tier is
    // re-measured on every bump rather than carried over.
    ".pyi": "# simply\nFine.\n",
  };

  it("covers every extension in VALE_PLAINTEXT_EXTENSIONS", () => {
    expect(Object.keys(PLAINTEXT_FIXTURES).toSorted()).toEqual(
      [...VALE_PLAINTEXT_EXTENSIONS].toSorted()
    );
  });

  it.each([...VALE_PLAINTEXT_EXTENSIONS])(
    "reads %s as plaintext, lint-through-syntax and all",
    (extension) => {
      // A bare line fires: the tier of last resort has no syntax to hide behind.
      expect(
        findings(`bare${extension}`, "simply\n"),
        `${extension} ignored a bare line — it has a parser, and is not plaintext`
      ).toHaveLength(1);
      // And the format's own non-prose syntax fires too, which is what makes it
      // plaintext rather than markup. `.mkdn` and `.mkd` are the cautionary
      // pair: they read as Markdown spellings and Vale lints straight through a
      // fenced code block in both.
      expect(
        findings(`syntax${extension}`, PLAINTEXT_FIXTURES[extension]!),
        `${extension} skipped its own syntax — it is parsed, and belongs in a markup or comment tier`
      ).toHaveLength(1);
    }
  );

  it("lints an unrecognized extension as whole-file prose", () => {
    // The fallback, stated as an assertion because it is a routing hazard
    // rather than a convenience: `.yml` has no parser, so a Vale rule scoped to
    // YAML flags key names and values, not only the comments. Both lines below
    // are findings, and neither is a comment.
    expect(findings("workflow.yml", "name: simply\n")).toHaveLength(1);
    expect(findings("script.sh", "simply\n")).toHaveLength(1);
    expect(findings("unknown.zzz", "simply\n")).toHaveLength(1);
  });

  it.each(
    VALE_CONVERTER_DEPENDENT.flatMap(({ extensions, converter }) =>
      extensions.map((extension) => [extension, converter] as const)
    )
  )("fails the whole run on %s, needing %s", (extension) => {
    // The blast radius is the point. Vale exits 2 and abandons the RUN, not
    // the file — `--no-exit` does not suppress it — so one such file caught
    // by any rule's glob silences every other Vale rule over every other
    // file. That is why route.md and create-vale-rule.md both say never to
    // put these extensions in a matcher.
    const cwd = anyExtension({
      [`doc${extension}`]: "We simply do it.\n",
    });
    const result = runRaw(cwd, [`doc${extension}`], ["--no-exit"]);
    expect(result.status, `${extension} no longer fails`).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain("E100");
    // Assert the checker tag, not the prose after it. The tag is the same
    // everywhere; the prose is not — `.xml` says `xsltproc not found` where
    // the program is absent and `no XSLT transform provided` where it is
    // present, and macOS ships `/usr/bin/xsltproc` while the Linux CI image
    // does not. Deriving the expectation from our own `converter` string
    // (`replace(/^an /, "").split(" ")[0]`) matched `XSLT` locally and failed
    // in CI on exactly that split — a host-dependent assertion dressed up as a
    // vendor contract. `converter` is still asserted, one level up, against
    // our own data where no binary is involved.
    expect(output).toContain(`[${VALE_CONVERTER_CHECKERS[extension]!}]`);
  });

  it("routes to a converter by EXACT-case extension", () => {
    // The half of the case question only the binary can answer, and it is not
    // the intuitive one: Vale routes on the extension exactly as spelled, so
    // an uppercase converter-dependent extension falls through to the
    // plain-text reader instead of crashing. `converterFor` matches this
    // exactly, which is why it no longer lowercases — a lowercasing lookup
    // named files in the skip notice that Vale had linted normally.
    //
    // Pinned rather than assumed because the direction matters in both ways.
    // If a future Vale becomes case-insensitive, `doc.ADOC` starts exiting
    // non-zero, this case goes red, and the lowercasing has to come back
    // before the crash reaches a user's run.
    for (const extension of VALE_CONVERTER_DEPENDENT_EXTENSIONS) {
      const upper = extension.toUpperCase();
      const name = `doc${upper}`;
      const cwd = anyExtension({ [name]: "We simply do it.\n" });
      const result = runRaw(cwd, [name], ["--no-exit"]);
      expect(result.status, `${upper} now needs a converter`).toBe(0);
      expect(`${result.stdout}${result.stderr}`).not.toContain("E100");
    }
  });

  it("names a checker for every converter-dependent extension", () => {
    // Set-equality, so an extension added to one and not the other fails here
    // rather than throwing on an undefined tag inside the probe above.
    expect(Object.keys(VALE_CONVERTER_CHECKERS).toSorted()).toEqual(
      [...VALE_CONVERTER_DEPENDENT_EXTENSIONS].toSorted()
    );
  });

  it("names something installable for every converter-dependent format", () => {
    // The actionability claim the probe used to make, asserted against our own
    // data instead of against a vendor string that varies by host. `.xml` is
    // deliberately allowed to name two things: the program AND the stylesheet,
    // because installing the program alone does not make `.xml` lintable.
    for (const { extensions, converter } of VALE_CONVERTER_DEPENDENT) {
      expect(converter, `${extensions.join("/")} names no tool`).not.toBe("");
      expect(converter).toMatch(/^[a-z]/);
    }
  });

  it("renders each list as recipe prose with no gaps", () => {
    expect(valeMarkupList().split(", ")).toEqual([...VALE_MARKUP_EXTENSIONS]);
    expect(valeCommentList().split(", ")).toEqual([...VALE_COMMENT_EXTENSIONS]);
    expect(valePlaintextList().split(", ")).toEqual([
      ...VALE_PLAINTEXT_EXTENSIONS,
    ]);
    for (const { extensions, converter } of VALE_CONVERTER_DEPENDENT) {
      expect(valeConverterList()).toContain(
        `${extensions.join("/")} (needs ${converter})`
      );
    }
  });
});

/**
 * The set Vale prints when rejecting an unknown `extends`.
 *
 * Structure first, free text second, the same order `enumerateFromBinary` in
 * `scripts/generate-vale-schema.ts` uses over the same diagnostic, and for the
 * same reason. This function feeds `VALE_CHECK_TYPES`, which the schema treats
 * as authoritative, and **a truncated enum is stricter than the binary**: a
 * loose scan of concatenated `stdout`+`stderr` that half-matched a changed
 * message would quietly shrink the vocabulary and start rejecting rules Vale
 * runs. So the exit status, the JSON envelope and the `E201` code are all
 * checked before the `Text` is read at all, and anything unfamiliar throws
 * rather than guesses.
 */
function enumeratedCheckTypes(): string[] {
  const cwd = project(
    `${header}\n[*.md]\nrules.bogus = YES\n`,
    { bogus: 'extends: nonsense\nmessage: "x"\nlevel: warning\n' },
    { "doc.md": "Just simply do it.\n" }
  );
  const result = runRaw(cwd, ["doc.md"], ["--no-exit"]);
  if (result.status === 0) {
    throw new Error(
      `Vale ${VALE_VERSION} no longer fails the run over an unknown ` +
        `'extends'. stdout: ${result.stdout}`
    );
  }

  // `asValeConfigError` is the CLI's own guard over this payload, reused
  // rather than re-stated, so a change to Vale's diagnostic envelope has one
  // place to be found instead of three.
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stderr.trim());
  } catch {
    throw new Error(
      `Vale ${VALE_VERSION} did not answer an unknown 'extends' with a JSON ` +
        `diagnostic on stderr: ${result.stderr}`
    );
  }
  const diagnostic = asValeConfigError(
    Array.isArray(parsed) ? parsed[0] : parsed
  );
  if (diagnostic === undefined) {
    throw new Error(
      `Vale ${VALE_VERSION} answered with a payload that is not a config ` +
        `error: ${result.stderr}`
    );
  }
  if (diagnostic.Code !== "E201") {
    throw new Error(
      `expected diagnostic code E201 for an unknown 'extends', got ` +
        `${diagnostic.Code} ("${diagnostic.Text}"). Refusing to read a ` +
        `vocabulary out of an error shape this test does not know.`
    );
  }

  const listed = /^'extends'[^[\]]*\[([^\]]+)]\.?$/.exec(
    diagnostic.Text.trim()
  );
  const names = listed?.[1];
  if (names === undefined) {
    throw new Error(
      `Vale ${VALE_VERSION} answered "${diagnostic.Text}", which no longer ` +
        `matches the enumeration shape this test reads. A short enum is ` +
        `STRICTER than the binary, so a partial parse would start rejecting ` +
        `rules Vale accepts. Fix the pattern against the new message.`
    );
  }
  return names.trim().split(/\s+/).filter(Boolean).toSorted();
}

/**
 * The check-type vocabulary, straight from the binary.
 *
 * Separate from the corpus in `vale-schema-contract.test.ts`, which measures
 * *behavior* — that a rule of each type fires. This asks the binary to
 * enumerate the set itself, which it does when handed an `extends` it does not
 * know. It is the version-bump tripwire: a Vale release that adds, drops or
 * renames a check type fails here and names the value, rather than leaving
 * `VALE_CHECK_TYPES` quietly wrong.
 */
withVale("check types", () => {
  it("rejects an unknown extends instead of ignoring it", () => {
    // Depended on by: the schema layer's claim that this defect has the same
    // blast radius as E201 rather than being the silent case. If Vale ever
    // starts ignoring an unknown `extends`, the rule becomes inert instead of
    // fatal and the recipe's wording is wrong.
    const cwd = project(
      `${header}\n[*.md]\nrules.bogus = YES\nrules.no-simply = YES\n`,
      {
        bogus: 'extends: nonsense\nmessage: "x"\nlevel: warning\n',
        "no-simply": existence("simply"),
      },
      { "doc.md": "Just simply do it.\n" }
    );
    const result = runRaw(cwd, ["doc.md"], ["--no-exit"]);
    expect(result.status).not.toBe(0);
    // And it takes the other rule down with it: one config per run.
    expect(result.stdout).not.toContain("no-simply");
  });

  it("enumerates exactly the check types the schema encodes", () => {
    // Depended on by: VALE_CHECK_TYPES in src/schemas/vale-rule.ts. A value
    // there that Vale does not list makes `verify` accept a rule that takes
    // the whole run down; a value Vale lists that is missing there makes
    // `verify` reject a rule that works.
    expect(enumeratedCheckTypes()).toEqual([...VALE_CHECK_TYPES].toSorted());
  });

  it("counts twelve, not the eleven the documentation enumerates", () => {
    // The docs fold `readability` into `metric`. They are separate checks with
    // disjoint fields, and each rejects the other's — see the corpus.
    const enumerated = enumeratedCheckTypes();
    expect(enumerated).toHaveLength(12);
    expect(enumerated).toContain("readability");
    expect(enumerated).toContain("metric");
  });
});

/**
 * Whether a `[section]` header's OWN matching shares the `--glob` CLI flag's
 * basename-at-any-depth behavior for a slash-free pattern.
 *
 * Raised in review of taskless/cli#323: `findOversizedFiles` (`vale/
 * formats.ts`) globs `AssembledValeConfig.sections` — the literal `[...]`
 * header strings a rule's `.vale.ini` declares, e.g. `[CLAUDE.md]` — through
 * node's `fs.promises.glob`. `converterExclusionGlobs`'s docblock, pinned
 * elsewhere in this file, establishes that Vale's `--glob` CLI flag matches a
 * slash-free pattern against a file's basename AT ANY DEPTH. If `[section]`
 * matching shared that behavior, a bare pattern like `[CLAUDE.md]` would scope
 * a rule to every `CLAUDE.md` in the tree, while node's `glob("CLAUDE.md")`
 * matches only the one at the project root — a real dialect mismatch that
 * would let an oversized, section-matched, deeply nested file escape this
 * scan silently.
 *
 * It does not share that behavior — measured here. `[section]` matching, for
 * a slash-free pattern, is anchored at the project root, exactly like node's
 * `glob()` already treats it. `findOversizedFiles`'s use of node's `glob`
 * against these section strings is therefore not a dialect mismatch for THIS
 * shape of pattern; it agrees with Vale by coincidence of a fact this test now
 * pins rather than by design.
 *
 * If Vale ever changes this — unifying `[section]` matching with `--glob`'s
 * basename-recursive semantics — this test fails, and `findOversizedFiles`'s
 * section-globbing needs the same depth-matching adjustment `converterFor`'s
 * callers already carry for the CLI flag.
 */
withVale("[section] header matching vs. the --glob CLI flag", () => {
  it("does NOT match a slash-free pattern's basename at every depth, unlike --glob", () => {
    const cwd = project(
      `${header}\n[CLAUDE.md]\nrules.no-simply = YES\n`,
      { "no-simply": existence("simply") },
      { "CLAUDE.md": "Just simply do it.\n" }
    );
    // `project`'s `documents` writer does not create parent directories, so
    // the nested fixture is added afterward.
    mkdirSync(join(cwd, "sub"), { recursive: true });
    writeFileSync(join(cwd, "sub", "CLAUDE.md"), "Just simply do it.\n");
    const result = runRaw(cwd, ["."], ["--no-exit"]);
    const stdout = JSON.parse(result.stdout) as Record<string, unknown>;
    // The root file is in scope...
    expect(Object.keys(stdout)).toContain("CLAUDE.md");
    // ...but the nested one, at a different depth, is not — confirming
    // `[section]` matching does not recurse a bare pattern the way `--glob`
    // does. If this ever changes, `sub/CLAUDE.md` starts appearing here.
    expect(Object.keys(stdout)).not.toContain("sub/CLAUDE.md");
  });
});
