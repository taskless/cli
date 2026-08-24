import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";
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
 *   `.tex` and `.rmd` are not markup, and it is the one the first hand-written
 *   table got backwards.
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
    // VALE_VERSION is rendered beside the reach lists in route.txt and
    // create-vale-rule.txt, so it is the attribution for every claim below.
    // It also gates two of them, in opposite directions: Vale 3.18.0 parses MDX
    // natively, so a bump past it moves `.mdx` from converter-dependent to
    // markup — and the same release adds a Typst converter, so it moves `.typ`
    // from plaintext to `converter:typst2vast`. A bump re-measures the whole
    // table; these two are only the rows already known to move.
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
   * `.rmd` is not R Markdown. The mirror image of the markup fixtures — same
   * documents, opposite expectation.
   */
  const PLAINTEXT_FIXTURES: Record<string, string> = {
    ".mkd": "Fine.\n\n```\nsimply\n```\n",
    ".mkdn": "Fine.\n\n```\nsimply\n```\n",
    ".rmd": "Fine.\n\n```{r}\nsimply <- 1\n```\n",
    ".tex": "% simply in a comment\nFine.\n",
    ".typ": "// simply\nFine.\n",
    // Documented by Vale as comment-aware, measured as plaintext on the pinned
    // binary — the construct here is the comment a parser would have skipped.
    ".pyi": "# simply\nFine.\n",
    ".qml": "// simply\nFine.\n",
    ".scss": "// simply\nFine.\n",
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
    // file. That is why route.txt and create-vale-rule.txt both say never to
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
