import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";
import {
  asValeConfigError,
  normalizeSeverity,
  stripRulesPrefix,
  toValeCheckResult,
  toValeCheckResults,
  type ValeFinding,
} from "../src/rules/vale/map";

/** The finding from the spec's worked example, as Vale emits it. */
const example: ValeFinding = {
  Check: "no-simply.no-simply",
  Severity: "warning",
  Line: 3,
  Span: [1, 7],
  Message: "Avoid 'simply'",
  Match: "simply",
};

describe("stripRulesPrefix", () => {
  it("strips the StylesPath prefix Vale prepends", () => {
    expect(stripRulesPrefix("no-simply.no-simply")).toBe("no-simply");
  });

  it("leaves a check that carries no prefix alone", () => {
    expect(stripRulesPrefix("no-simply")).toBe("no-simply");
  });

  it("strips only the leading occurrence", () => {
    // A rule may legitimately contain the substring; only the prefix is ours.
    // Only a doubled name collapses. `rules.thing` came from a style the CLI
    // did not lay out, and halving it would report an id identifying nothing.
    expect(stripRulesPrefix("rules.thing")).toBe("rules.thing");
    expect(stripRulesPrefix("house-rules.thing")).toBe("house-rules.thing");
  });
});

describe("normalizeSeverity", () => {
  it("maps Vale's three levels", () => {
    expect(normalizeSeverity("error")).toBe("error");
    expect(normalizeSeverity("warning")).toBe("warning");
    // The only one that renames.
    expect(normalizeSeverity("suggestion")).toBe("hint");
  });

  it("is case-insensitive", () => {
    expect(normalizeSeverity("Suggestion")).toBe("hint");
    expect(normalizeSeverity("ERROR")).toBe("error");
  });

  it("keeps an unrecognized level as a finding rather than dropping it", () => {
    expect(normalizeSeverity("catastrophe")).toBe("warning");
  });
});

describe("toValeCheckResult", () => {
  it("maps the spec's worked example", () => {
    // Vale's `Line: 3` / `Span: [1, 7]` are 1-based; `CheckResult.range` is
    // 0-indexed for every source, so each drops by one on the way in.
    expect(toValeCheckResult("docs/a.md", example)).toEqual({
      source: "vale",
      ruleId: "no-simply",
      severity: "warning",
      message: "Avoid 'simply'",
      note: undefined,
      file: "docs/a.md",
      range: {
        start: { line: 2, column: 0 },
        end: { line: 2, column: 6 },
      },
      matchedText: "simply",
      fix: undefined,
    });
  });

  it("clamps at 0 rather than emitting a negative position", () => {
    // A 0 from Vale means "unset", not "one before the first column".
    const result = toValeCheckResult("docs/a.md", {
      ...example,
      Line: 0,
      Span: [0, 0],
    });
    expect(result.range).toEqual({
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    });
  });

  it("keeps a finding on one line, since Vale has no multi-line span", () => {
    const result = toValeCheckResult("docs/a.md", example);
    expect(result.range.start.line).toBe(result.range.end.line);
  });

  describe("raw-scope leading newlines", () => {
    // `raw` patterns are conventionally anchored with a leading `\n` so they
    // can require "start of line" against the unparsed document. That `\n`
    // is part of the match, and Vale attributes `Line` to where the match
    // itself starts (the newline ending the previous line) rather than to
    // the line the flagged text is actually on. See `leadingNewlines` in
    // map.ts.

    it("advances the line by one for a single leading newline", () => {
      // Vale's `Line: 12` here names the blank line before the flagged text,
      // which is truly on line 13 (1-based) / 12 (0-based).
      const result = toValeCheckResult("docs/a.md", {
        ...example,
        Line: 12,
        Match: "\n**The base is a promise about the build.**",
      });
      expect(result.range.start.line).toBe(12);
    });

    it("advances the line by the count of leading newlines, not just one", () => {
      const result = toValeCheckResult("docs/a.md", {
        ...example,
        Line: 10,
        Match: "\n\nSome flagged text",
      });
      expect(result.range.start.line).toBe(11);
    });

    it("leaves a default-scope match (no leading newline) unaffected", () => {
      const result = toValeCheckResult("docs/a.md", {
        ...example,
        Line: 9,
        Match: "To be honest",
      });
      expect(result.range.start.line).toBe(8);
    });

    it("does not count a newline appearing after the match's start", () => {
      // Only *leading* newlines are the artifact of the anchoring pattern; an
      // embedded one is part of the matched content, not a start-of-match
      // marker, and must not shift the line.
      const result = toValeCheckResult("docs/a.md", {
        ...example,
        Line: 9,
        Match: "To be honest\nabout it",
      });
      expect(result.range.start.line).toBe(8);
    });

    describe("column", () => {
      // `Span` for a leading-newline match is measured against the line
      // Vale (wrongly) attributed the match to, not the corrected one — see
      // `rawScopeColumns` in map.ts. These pin the two shapes with a
      // fabricated `Span`, mirroring what a non-blank preceding line
      // produces on the real binary (confirmed separately below); a
      // real-Vale-binary case with an actually non-blank predecessor lives
      // in the suite further down.

      it("resets the column to the start of the corrected line for a single leading newline", () => {
        // A `Span` that, read against the *wrong* line, would put the match
        // 40 columns in — but the real content starts at column 1 of the
        // corrected line regardless of how long the previous line was.
        const result = toValeCheckResult("docs/a.md", {
          ...example,
          Line: 9,
          Span: [41, 53],
          Match: "\nTo be honest",
        });
        expect(result.range.start.column).toBe(0);
        // Stripped match ("To be honest") is 12 characters.
        expect(result.range.end.column).toBe(11);
      });

      it("resets the column the same way for two leading newlines", () => {
        const result = toValeCheckResult("docs/a.md", {
          ...example,
          Line: 9,
          Span: [41, 55],
          Match: "\n\nTo be honest",
        });
        expect(result.range.start.column).toBe(0);
        expect(result.range.end.column).toBe(11);
      });

      it("leaves the column alone when there is no leading newline", () => {
        // The pre-existing, unaffected path: `Span` already describes the
        // real line, so it converts down by one exactly as before.
        const result = toValeCheckResult("docs/a.md", example);
        expect(result.range.start.column).toBe(0);
        expect(result.range.end.column).toBe(6);
      });
    });
  });

  it("joins Description and Link into note, and omits it when both are empty", () => {
    expect(
      toValeCheckResult("a.md", { ...example, Description: "Say it plainly." })
        .note
    ).toBe("Say it plainly.");
    expect(
      toValeCheckResult("a.md", { ...example, Link: "https://example.test" })
        .note
    ).toBe("https://example.test");
    expect(
      toValeCheckResult("a.md", {
        ...example,
        Description: "Say it plainly.",
        Link: "https://example.test",
      }).note
    ).toBe("Say it plainly. https://example.test");
    expect(
      toValeCheckResult("a.md", { ...example, Description: "", Link: "" }).note
    ).toBeUndefined();
  });

  describe("fix", () => {
    it("comes from a replace action's replacement", () => {
      expect(
        toValeCheckResult("a.md", {
          ...example,
          Action: { Name: "replace", Params: ["plainly"] },
        }).fix
      ).toBe("plainly");
    });

    it("is absent for an unpopulated action", () => {
      expect(
        toValeCheckResult("a.md", {
          ...example,
          Action: { Name: "", Params: null },
        }).fix
      ).toBeUndefined();
    });

    it("is absent for an action that carries no replacement text", () => {
      // `remove` describes an edit whose result is not in the payload. Putting
      // the action's name in `fix` would offer to replace the match with the
      // word "remove".
      expect(
        toValeCheckResult("a.md", {
          ...example,
          Action: { Name: "remove", Params: [] },
        }).fix
      ).toBeUndefined();
    });
  });
});

/**
 * These run the real Vale binary rather than fabricating `ValeFinding`
 * objects, because the whole bug (#297) was Vale's own reported `Line`
 * disagreeing with the true line, and a hand-built fixture would only prove
 * that `toValeCheckResult` does what we assume Vale does, not what it
 * actually does. Vale ships as an `optionalDependency` for the host
 * platform, so it is present in CI and absent only on an unsupported arch.
 */
const valeAvailable = findValeBinary().path !== undefined;
const withVale = valeAvailable ? describe : describe.skip;

withVale("toValeCheckResult against the real Vale binary", () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  /**
   * A document with YAML front matter (`---` on lines 1 and 3 here), since
   * the issue's repro documents all carried front matter and the bug was
   * measured against them.
   *
   * Lines 11-12 and 14-16 exist to close a gap a reviewer found in the
   * original fixture: both raw-scope targets there were preceded by a
   * *blank* line, whose zero length happens to make the uncorrected column
   * come out right by coincidence. Line 12 is preceded by a non-blank line
   * instead, and line 16 is reached by a match with *two* leading newlines,
   * so both the column fix and the newline-count generalization are pinned
   * against the real binary rather than only the single-newline,
   * blank-predecessor case.
   *
   * Line numbers (1-based), annotated because the test asserts against them:
   *   1: ---
   *   2: title: Test
   *   3: ---
   *   4: (blank)
   *   5: Intro paragraph.
   *   6: (blank)
   *   7: To be honest, this is the default-scope target.
   *   8: (blank)
   *   9: **The base is a promise about the build.** Raw-scope target.
   *  10: (blank)
   *  11: This is a long non-blank preceding line so the raw column bug would show if uncorrected.
   *  12: ## Heading Right After Prose
   *  13: (blank)
   *  14: A line with some prose to precede the blank separator before a heading.
   *  15: (blank)
   *  16: ## Heading After Two Blank Lines
   */
  const fixture = [
    "---",
    "title: Test",
    "---",
    "",
    "Intro paragraph.",
    "",
    "To be honest, this is the default-scope target.",
    "",
    "**The base is a promise about the build.** Raw-scope target.",
    "",
    "This is a long non-blank preceding line so the raw column bug would show if uncorrected.",
    "## Heading Right After Prose",
    "",
    "A line with some prose to precede the blank separator before a heading.",
    "",
    "## Heading After Two Blank Lines",
  ].join("\n");

  function runValeDirect(): ValeFinding[] {
    const cwd = mkdtempSync(join(tmpdir(), "vale-map-"));
    workspaces.push(cwd);
    mkdirSync(join(cwd, "styles", "Test"), { recursive: true });
    writeFileSync(
      join(cwd, ".vale.ini"),
      "StylesPath = styles\nMinAlertLevel = suggestion\n\n[*.md]\nBasedOnStyles = Test\n"
    );
    writeFileSync(
      join(cwd, "styles", "Test", "DefaultScope.yml"),
      "extends: existence\nmessage: \"Avoid '%s'\"\nlevel: warning\nignorecase: true\ntokens:\n  - 'to be honest'\n"
    );
    writeFileSync(
      join(cwd, "styles", "Test", "RawScope.yml"),
      "extends: existence\nmessage: \"Raw hit: '%s'\"\nlevel: warning\nscope: raw\nraw:\n  - '\\n\\*\\*The base is a promise.*'\n"
    );
    // Anchored on a single `\n`, but preceded by a non-blank line — the case
    // the blank-predecessor `RawScope` rule above cannot distinguish a
    // correct column fix from a coincidentally-right one.
    writeFileSync(
      join(cwd, "styles", "Test", "RawScopeAfterProse.yml"),
      "extends: existence\nmessage: \"Raw hit: '%s'\"\nlevel: warning\nscope: raw\nraw:\n  - '\\n## Heading Right After Prose'\n"
    );
    // Anchored on two leading `\n`s, to pin the newline *count* (not just
    // its presence) against the real binary for both line and column.
    writeFileSync(
      join(cwd, "styles", "Test", "RawScopeTwoNewlines.yml"),
      "extends: existence\nmessage: \"Raw hit: '%s'\"\nlevel: warning\nscope: raw\nraw:\n  - '\\n\\n## Heading After Two Blank Lines'\n"
    );
    writeFileSync(join(cwd, "doc.md"), fixture);

    const { path: binary } = findValeBinary();
    const result = spawnSync(
      binary as string,
      ["--config=.vale.ini", "--output=JSON", "doc.md"],
      { cwd, encoding: "utf8" }
    );
    const output = JSON.parse(result.stdout) as Record<string, ValeFinding[]>;
    return output["doc.md"] ?? [];
  }

  it("reports the true line for a default-scope rule", () => {
    const findings = runValeDirect();
    const finding = findings.find((f) => f.Check === "Test.DefaultScope");
    expect(finding).toBeDefined();
    // True (1-based) line is 7; `CheckResult.range` is 0-indexed.
    const result = toValeCheckResult("doc.md", finding!);
    expect(result.range.start.line).toBe(6);
  });

  it("reports the true line for a raw-scope rule, correcting the leading-newline offset", () => {
    const findings = runValeDirect();
    const finding = findings.find((f) => f.Check === "Test.RawScope");
    expect(finding).toBeDefined();
    // True (1-based) line is 9; `CheckResult.range` is 0-indexed. Vale itself
    // reports `Line: 8` here (the blank line before), which this test would
    // catch a regression back to if `leadingNewlines` were removed.
    const result = toValeCheckResult("doc.md", finding!);
    expect(result.range.start.line).toBe(8);
  });

  it("reports the true line and column when the leading newline follows a non-blank line", () => {
    // The blank-predecessor `RawScope` case above has a zero-length
    // preceding line, so an uncorrected column happens to come out right.
    // A non-blank predecessor exposes that: Vale measures `Span` as a
    // character count starting from that predecessor's own line, straight
    // through the leading `\n` and into the flagged text, so an uncorrected
    // column would land dozens of characters past where the text starts.
    const findings = runValeDirect();
    const finding = findings.find((f) => f.Check === "Test.RawScopeAfterProse");
    expect(finding).toBeDefined();
    // Measured against the real binary: `Line: 11` (the 88-character
    // preceding line), `Span: [89, 117]` (88 + 1, and 88 + 29 - 1, where 29
    // is the whole match's length including its leading `\n`).
    expect(finding!.Line).toBe(11);
    expect(finding!.Span).toEqual([89, 117]);
    const result = toValeCheckResult("doc.md", finding!);
    // True (1-based) line is 12; `CheckResult.range` is 0-indexed.
    expect(result.range.start.line).toBe(11);
    // The flagged text starts at the true line's first column, and its
    // stripped length (without the leading newline) is 28, so the last
    // character sits at 0-based column 27.
    expect(result.range.start.column).toBe(0);
    expect(result.range.end.column).toBe(27);
  });

  it("reports the true line and column for two leading newlines, not just one", () => {
    // Closes the gap the reviewer found in the original single-newline-only
    // real-binary coverage: this pins that Vale's line/column attribution
    // for a raw match generalizes to N leading newlines, rather than only
    // ever being off by exactly one.
    const findings = runValeDirect();
    const finding = findings.find(
      (f) => f.Check === "Test.RawScopeTwoNewlines"
    );
    expect(finding).toBeDefined();
    // True (1-based) line is 16. Vale attributes the match to line 14 (two
    // lines early, one per leading newline), the 73-character line
    // preceding the blank separator.
    expect(finding!.Line).toBe(14);
    const result = toValeCheckResult("doc.md", finding!);
    expect(result.range.start.line).toBe(15);
    expect(result.range.start.column).toBe(0);
    // Stripped match ("## Heading After Two Blank Lines") is 32 characters.
    expect(result.range.end.column).toBe(31);
  });
});

describe("toValeCheckResults", () => {
  it("pushes the file key down onto each finding", () => {
    const results = toValeCheckResults({
      "docs/a.md": [example],
      "docs/b.md": [{ ...example, Check: "no-very.no-very", Match: "very" }],
    });
    expect(results.map((result) => [result.file, result.ruleId])).toEqual([
      ["docs/a.md", "no-simply"],
      ["docs/b.md", "no-very"],
    ]);
  });

  it("returns nothing for an empty payload", () => {
    expect(toValeCheckResults({})).toEqual([]);
  });

  it("tolerates a file key with no findings", () => {
    expect(toValeCheckResults({ "docs/a.md": [] })).toEqual([]);
  });
});

describe("asValeConfigError", () => {
  /**
   * Captured from the real binary by giving a rule `level: catastrophe`. Vale
   * sends this to stderr with exit 2, so `runVale` reports it as a failure and
   * it does not reach the mapper today; these cases pin the guard that keeps a
   * future stdout-reported config error from crashing instead of reporting.
   */
  const configError = {
    Line: 3,
    Path: "/x/.taskless/vale/rules/bogus.yml",
    Text: "'level' must be one of [suggestion warning error]",
    Code: "E201",
    Span: 1,
  };

  it("recognizes the config-error payload", () => {
    expect(asValeConfigError(configError)?.Code).toBe("E201");
  });

  it("does not mistake a findings payload for one", () => {
    expect(asValeConfigError({ "docs/a.md": [example] })).toBeUndefined();
    expect(asValeConfigError({})).toBeUndefined();
    expect(asValeConfigError(null)).toBeUndefined();
  });

  it("does not throw when a config error reaches the mapper anyway", () => {
    // Without the Array.isArray guard this dies with `(findings ?? []).map is
    // not a function`: Object.entries walks Line/Path/Code and calls .map on a
    // number. An uncaught throw here would abort the other engines, which is
    // precisely what D6b forbids.
    expect(() =>
      toValeCheckResults(
        configError as unknown as Parameters<typeof toValeCheckResults>[0]
      )
    ).not.toThrow();
  });
});
