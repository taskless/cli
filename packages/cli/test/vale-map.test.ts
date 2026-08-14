import { describe, expect, it } from "vitest";

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

describe("toValeCheckResults", () => {
  it("pushes the file key down onto each finding", () => {
    const results = toValeCheckResults({
      "docs/a.md": [example],
      "docs/b.md": [{ ...example, Check: "rules.no-very", Match: "very" }],
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
