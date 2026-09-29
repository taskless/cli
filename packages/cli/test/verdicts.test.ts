import { describe, expect, it } from "vitest";

import type { ReportedRule } from "../src/rules/report";
import { applyVerdicts, NOT_IN_PLAN_REASON } from "../src/rules/verdicts";

const restore = (id: string) => `taskless rule restore ${id}`;

const SG: ReportedRule = {
  ruleId: "no-eval-3fa9c21b",
  engine: "sg",
  files: [],
};
const VALE: ReportedRule = {
  ruleId: "no-simply-1a2b3c4d",
  engine: "vale",
  files: [],
};
const RT: ReportedRule = {
  ruleId: "no-env-leak-00000000",
  engine: "runtime",
  files: [],
};

const entitled = { runtimeSignatures: true };

function run(rule: ReportedRule) {
  return {
    ruleId: rule.ruleId,
    engine: rule.engine,
    verdict: "run",
    revisionId: "r1",
  };
}

describe("applyVerdicts", () => {
  it("runs every rule answered run", () => {
    const plan = applyVerdicts(
      [SG, VALE, RT],
      {
        rules: [run(SG), run(VALE), run(RT)],
        unknown: [],
        entitlement: entitled,
      },
      restore
    );
    expect(plan.dispositions.every((d) => d.run)).toBe(true);
    expect(plan.failures).toEqual([]);
    expect(plan.integrity).toEqual([]);
    expect(plan.notices).toEqual([]);
  });

  it("an unsafe static rule does not run, fails, and names restore", () => {
    const plan = applyVerdicts(
      [VALE],
      {
        rules: [
          {
            ruleId: VALE.ruleId,
            engine: "vale",
            verdict: "unsafe",
            files: [
              { path: ".vale.ini", expected: "e", got: "g" },
              { path: "extra.yml", got: "g" },
              { path: "no-simply-1a2b3c4d.yml", expected: "e" },
            ],
          },
        ],
        unknown: [],
        entitlement: entitled,
      },
      restore
    );
    expect(plan.dispositions).toMatchObject([{ run: false }]);
    expect(plan.failures).toHaveLength(1);
    expect(plan.failures[0]).toContain(
      "changed .vale.ini; added extra.yml; removed no-simply-1a2b3c4d.yml"
    );
    expect(plan.failures[0]).toContain(restore(VALE.ruleId));
    expect(plan.integrity[0]).toMatchObject({
      verdict: "unsafe",
      engine: "vale",
    });
  });

  it("an unsafe runtime rule does not run and does NOT fail", () => {
    const plan = applyVerdicts(
      [RT],
      {
        rules: [
          {
            ruleId: RT.ruleId,
            engine: "runtime",
            verdict: "unsafe",
            files: [],
          },
        ],
        unknown: [],
        entitlement: entitled,
      },
      restore
    );
    expect(plan.dispositions).toMatchObject([{ run: false }]);
    expect(plan.failures).toEqual([]);
    expect(plan.notices[0]).toContain(restore(RT.ruleId));
  });

  it("unknown: static runs silently, runtime does not run", () => {
    const plan = applyVerdicts(
      [SG, RT],
      {
        rules: [],
        unknown: [{ ruleId: SG.ruleId }, { ruleId: RT.ruleId }],
        entitlement: entitled,
      },
      restore
    );
    expect(plan.dispositions).toEqual([
      { ruleId: SG.ruleId, engine: "sg", run: true, verdict: "unknown" },
      expect.objectContaining({ ruleId: RT.ruleId, run: false }),
    ]);
    expect(plan.notices).toEqual([]);
    expect(plan.integrity).toEqual([
      { ruleId: RT.ruleId, engine: "runtime", verdict: "unknown" },
    ]);
  });

  it("withheld is matched by rule id, never runs, and is not offered restore", () => {
    const plan = applyVerdicts(
      [RT],
      {
        rules: [],
        unknown: [],
        entitlement: {
          runtimeSignatures: false,
          withheld: [{ ruleId: RT.ruleId, revisionId: "r1" }],
        },
      },
      restore
    );
    expect(plan.withheld).toEqual([RT.ruleId]);
    expect(plan.dispositions).toEqual([
      {
        ruleId: RT.ruleId,
        engine: "runtime",
        run: false,
        verdict: "withheld",
        reason: NOT_IN_PLAN_REASON,
      },
    ]);
    expect(plan.notices.join("")).not.toContain("restore");
  });

  it("a reported rule in none of the lists is unaccounted: no run, fails", () => {
    const plan = applyVerdicts(
      [SG],
      { rules: [], unknown: [], entitlement: entitled },
      restore
    );
    expect(plan.dispositions).toMatchObject([{ run: false }]);
    expect(plan.failures[0]).toContain("did not account for it");
    expect(plan.integrity).toEqual([
      { ruleId: SG.ruleId, engine: "sg", verdict: "unaccounted" },
    ]);
  });

  it("a rule answered twice is unaccounted", () => {
    const plan = applyVerdicts(
      [RT],
      {
        rules: [run(RT)],
        unknown: [],
        entitlement: {
          runtimeSignatures: false,
          withheld: [{ ruleId: RT.ruleId, revisionId: "r1" }],
        },
      },
      restore
    );
    expect(plan.failures[0]).toContain("more than once");
    expect(plan.withheld).toEqual([]);
  });

  it("an answer judging a different engine is unaccounted", () => {
    const plan = applyVerdicts(
      [SG],
      {
        rules: [{ ...run(SG), engine: "vale" }],
        unknown: [],
        entitlement: entitled,
      },
      restore
    );
    expect(plan.dispositions).toMatchObject([{ run: false }]);
    expect(plan.failures[0]).toContain("judged it as a vale rule");
  });

  it("missing for an unreported rule warns with its revision and never fails", () => {
    const plan = applyVerdicts(
      [],
      {
        rules: [
          {
            ruleId: "gone-3fa9c21b",
            engine: "sg",
            verdict: "missing",
            revisionId: "r9",
          },
        ],
        unknown: [],
        entitlement: entitled,
      },
      restore
    );
    expect(plan.failures).toEqual([]);
    expect(plan.integrity).toEqual([
      {
        ruleId: "gone-3fa9c21b",
        engine: "sg",
        verdict: "missing",
        revisionId: "r9",
      },
    ]);
    expect(plan.notices[0]).toContain(restore("gone-3fa9c21b"));
  });

  it("missing for a REPORTED rule is not a verdict for it, so it is unaccounted", () => {
    const plan = applyVerdicts(
      [SG],
      {
        rules: [
          {
            ruleId: SG.ruleId,
            engine: "sg",
            verdict: "missing",
            revisionId: "r1",
          },
        ],
        unknown: [],
        entitlement: entitled,
      },
      restore
    );
    expect(plan.dispositions).toMatchObject([{ run: false }]);
    expect(plan.failures).toHaveLength(1);
  });

  it("a malformed body accounts for nothing, so every reported rule fails", () => {
    const plan = applyVerdicts([SG, RT], "not an object", restore);
    expect(plan.dispositions.every((d) => !d.run)).toBe(true);
    expect(plan.failures).toHaveLength(2);
  });
});
