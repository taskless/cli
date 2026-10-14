import { describe, expect, it } from "vitest";

import { countFindings, type CountedRule } from "../src/report/findings";
import type { CheckResult } from "../src/types/check";

const cwd = "/repo";

function result(ruleId: string, file: string): CheckResult {
  return {
    source: "ast-grep",
    ruleId,
    severity: "warning",
    message: `no ${ruleId}`,
    file,
    range: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } },
    matchedText: ruleId,
  };
}

const sg = (id: string): CountedRule => ({ id, engine: "sg" });
const vale = (id: string): CountedRule => ({ id, engine: "vale" });

describe("countFindings", () => {
  it("counts every written rule, and the total as the sum", () => {
    const measurement = countFindings({
      cwd,
      rules: [sg("a"), sg("b"), sg("c"), vale("d")],
      failures: [],
      results: [
        ...Array.from({ length: 4 }, (_, n) =>
          result("a", `src/a${String(n)}.ts`)
        ),
        ...Array.from({ length: 75 }, () => result("b", "src/b.ts")),
        ...Array.from({ length: 12 }, () => result("d", "README.md")),
      ],
    });
    expect(measurement.measured).toBe(true);
    if (!measurement.measured) return;
    expect(Object.fromEntries(measurement.perRule)).toEqual({
      a: { violations: 4, files: 4 },
      b: { violations: 75, files: 1 },
      c: { violations: 0, files: 0 },
      d: { violations: 12, files: 1 },
    });
    expect(measurement.findings).toEqual({ violations: 91, files: 6 });
  });

  it("counts a file two rules break once in the total", () => {
    const measurement = countFindings({
      cwd,
      rules: [sg("a"), sg("b")],
      failures: [],
      results: [result("a", "src/x.ts"), result("b", "src/x.ts")],
    });
    expect(measurement).toMatchObject({
      measured: true,
      findings: { violations: 2, files: 1 },
    });
  });

  it("treats two spellings of one path as one file", () => {
    const measurement = countFindings({
      cwd,
      rules: [sg("a")],
      failures: [],
      results: [
        result("a", "./src/x.ts"),
        result("a", "src/x.ts"),
        result("a", "/repo/src/x.ts"),
      ],
    });
    expect(measurement).toMatchObject({
      measured: true,
      findings: { violations: 3, files: 1 },
    });
  });

  it("measures nothing when a runtime rule is present", () => {
    const measurement = countFindings({
      cwd,
      rules: [sg("a"), { id: "tenant", engine: "runtime" }],
      failures: [],
      results: [],
    });
    expect(measurement).toEqual({
      measured: false,
      reason: "runtime rules do not run for a report: tenant",
    });
  });

  it("measures nothing when the scan reports a failure", () => {
    const measurement = countFindings({
      cwd,
      rules: [sg("a")],
      failures: ["vale engine failed: boom"],
      results: [result("a", "src/x.ts")],
    });
    expect(measurement.measured).toBe(false);
  });

  it("measures nothing when a result names a rule the report lacks", () => {
    // An sg rule whose body `id:` differs from its directory reports under
    // the body's id. Counting on would publish a confident 0 for it.
    const measurement = countFindings({
      cwd,
      rules: [sg("a")],
      failures: [],
      results: [result("a", "src/x.ts"), result("renamed", "src/y.ts")],
    });
    expect(measurement).toEqual({
      measured: false,
      reason: "results named rules the report does not have: renamed",
    });
  });
});
