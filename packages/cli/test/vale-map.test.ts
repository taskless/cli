import { describe, expect, it } from "vitest";

import {
  normalizeSeverity,
  stripRulesPrefix,
  toValeCheckResult,
  toValeCheckResults,
  type ValeFinding,
} from "../src/rules/vale/map";

/** The finding from the spec's worked example, as Vale emits it. */
const example: ValeFinding = {
  Check: "rules.no-simply",
  Severity: "warning",
  Line: 3,
  Span: [1, 7],
  Message: "Avoid 'simply'",
  Match: "simply",
};

describe("stripRulesPrefix", () => {
  it("strips the StylesPath prefix Vale prepends", () => {
    expect(stripRulesPrefix("rules.no-simply")).toBe("no-simply");
  });

  it("leaves a check that carries no prefix alone", () => {
    expect(stripRulesPrefix("no-simply")).toBe("no-simply");
  });

  it("strips only the leading occurrence", () => {
    // A rule may legitimately contain the substring; only the prefix is ours.
    expect(stripRulesPrefix("rules.rules.thing")).toBe("rules.thing");
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
    expect(toValeCheckResult("docs/a.md", example)).toEqual({
      source: "vale",
      ruleId: "no-simply",
      severity: "warning",
      message: "Avoid 'simply'",
      note: undefined,
      file: "docs/a.md",
      range: {
        start: { line: 3, column: 1 },
        end: { line: 3, column: 7 },
      },
      matchedText: "simply",
      fix: undefined,
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
