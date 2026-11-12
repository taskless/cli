import { describe, expect, it } from "vitest";

import { checkSummarySchema } from "../src/schemas/check";
import { summarizeFindings } from "../src/rules/summarize-findings";
import type { CheckResult } from "../src/types/check";

function finding(
  overrides: Partial<CheckResult> & Pick<CheckResult, "ruleId">
): CheckResult {
  return {
    source: "ast-grep",
    severity: "error",
    message: "m",
    file: "a.ts",
    range: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } },
    matchedText: "x",
    ...overrides,
  };
}

describe("summarizeFindings", () => {
  it("is empty for no findings", () => {
    expect(summarizeFindings("/repo", [])).toEqual({
      total: 0,
      files: 0,
      severities: { error: 0, warning: 0, info: 0, hint: 0 },
      rules: [],
    });
  });

  it("counts per rule, most findings first, files once per spelling", () => {
    const summary = summarizeFindings("/repo", [
      finding({ ruleId: "b", file: "a.ts" }),
      finding({ ruleId: "a", file: "a.ts", severity: "warning" }),
      finding({ ruleId: "a", file: "./a.ts", severity: "hint" }),
      finding({ ruleId: "a", file: "/repo/b.ts", severity: "warning" }),
    ]);

    expect(checkSummarySchema.parse(summary)).toEqual(summary);
    expect(summary.total).toBe(4);
    expect(summary.files).toBe(2);
    expect(summary.severities).toEqual({
      error: 1,
      warning: 2,
      info: 0,
      hint: 1,
    });
    expect(summary.rules).toEqual([
      {
        engine: "sg",
        ruleId: "a",
        total: 3,
        files: 2,
        severities: { error: 0, warning: 2, info: 0, hint: 1 },
      },
      {
        engine: "sg",
        ruleId: "b",
        total: 1,
        files: 1,
        severities: { error: 1, warning: 0, info: 0, hint: 0 },
      },
    ]);
  });

  it("keeps one id under two engines apart", () => {
    const summary = summarizeFindings("/repo", [
      finding({ ruleId: "dup", source: "ast-grep" }),
      finding({ ruleId: "dup", source: "vale" }),
      finding({ ruleId: "dup", source: "taskless-runtime" }),
    ]);

    expect(
      summary.rules.map((rule) => [rule.engine, rule.ruleId, rule.total])
    ).toEqual([
      ["runtime", "dup", 1],
      ["sg", "dup", 1],
      ["vale", "dup", 1],
    ]);
  });

  it("leaves engine out for a source it does not map", () => {
    const [rule] = summarizeFindings("/repo", [
      finding({ ruleId: "x", source: "something-else" }),
    ]).rules;
    expect(rule).not.toHaveProperty("engine");
  });
});
