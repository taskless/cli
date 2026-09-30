import { describe, expect, it } from "vitest";

import type { ReportedRule } from "../src/rules/report";
import { recoveryAdvice } from "../src/rules/recovery-advice";
import { applyVerdicts, NOT_IN_PLAN_REASON } from "../src/rules/verdicts";

const restore = (id: string) => `taskless rule restore ${id}`;
// Unknown plan: today's `rule restore` suggestions, word for word.
const recovery = recoveryAdvice(undefined, restore);

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
      recovery
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
      recovery
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
      recovery
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
      recovery
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

  describe("copyOf (taskless/taskless#255)", () => {
    const SOURCE = "no-simply-00000000";
    const COPY_OF = {
      ruleId: SOURCE,
      revisionId: "r7",
      files: [{ path: ".vale.ini", expected: "e", got: "g" }],
    };
    const missingSource = {
      ruleId: SOURCE,
      engine: "vale",
      verdict: "missing",
      revisionId: "r8",
    };

    it("a static copy whose source is still present does not run and fails, naming the source", () => {
      const plan = applyVerdicts(
        [VALE],
        {
          rules: [],
          unknown: [{ ruleId: VALE.ruleId, copyOf: COPY_OF }],
          entitlement: entitled,
        },
        recovery
      );
      expect(plan.dispositions).toEqual([
        {
          ruleId: VALE.ruleId,
          engine: "vale",
          run: false,
          verdict: "unknown",
          reason: `a copy of Taskless rule ${SOURCE} (changed .vale.ini)`,
        },
      ]);
      expect(plan.failures).toEqual([
        `vale rule ${VALE.ruleId} is a copy of Taskless rule ${SOURCE} (changed .vale.ini), so it did not run and \`check\` fails. Delete .taskless/rules/vale/${VALE.ruleId}/, or rewrite the files it carries from ${SOURCE} so it is your own rule.`,
      ]);
      expect(plan.notices).toEqual([]);
      expect(plan.integrity).toEqual([
        {
          ruleId: VALE.ruleId,
          engine: "vale",
          verdict: "unknown",
          files: COPY_OF.files,
          copyOf: { ruleId: SOURCE, revisionId: "r7", sourceMissing: false },
        },
      ]);
    });

    it("a static copy whose source is missing is ONE rename failure, not a copy plus a missing warning", () => {
      const plan = applyVerdicts(
        [VALE],
        {
          rules: [missingSource],
          unknown: [{ ruleId: VALE.ruleId, copyOf: COPY_OF }],
          entitlement: entitled,
        },
        recovery
      );
      expect(plan.dispositions).toMatchObject([{ run: false }]);
      expect(plan.failures).toEqual([
        `vale rule ${VALE.ruleId} is a copy of Taskless rule ${SOURCE}, which was deleted (changed .vale.ini), so it did not run and \`check\` fails. Run \`${restore(SOURCE)}\` to put back the issued rule, then delete .taskless/rules/vale/${VALE.ruleId}/.`,
      ]);
      expect(plan.notices).toEqual([]);
      // Both facts stay machine-readable: the missing entry carries the
      // revision restore brings back.
      expect(plan.integrity).toEqual([
        expect.objectContaining({
          ruleId: VALE.ruleId,
          copyOf: { ruleId: SOURCE, revisionId: "r7", sourceMissing: true },
        }),
        {
          ruleId: SOURCE,
          engine: "vale",
          verdict: "missing",
          revisionId: "r8",
        },
      ]);
    });

    it("a missing rule no copy names still warns on its own", () => {
      const plan = applyVerdicts(
        [SG],
        {
          rules: [{ ...missingSource, ruleId: "other-11111111" }],
          unknown: [{ ruleId: SG.ruleId, copyOf: COPY_OF }],
          entitlement: entitled,
        },
        recovery
      );
      expect(plan.failures).toHaveLength(1);
      expect(plan.failures[0]).toContain(`sg rule ${SG.ruleId} is a copy of`);
      expect(plan.failures[0]).not.toContain("deleted");
      expect(plan.notices).toHaveLength(1);
      expect(plan.notices[0]).toContain(restore("other-11111111"));
    });

    it("a runtime copy is not executed and does not fail; its skip reason names the source", () => {
      const plan = applyVerdicts(
        [RT],
        {
          rules: [],
          unknown: [{ ruleId: RT.ruleId, copyOf: { ...COPY_OF, files: [] } }],
          entitlement: entitled,
        },
        recovery
      );
      expect(plan.failures).toEqual([]);
      expect(plan.notices).toEqual([]);
      expect(plan.dispositions).toEqual([
        {
          ruleId: RT.ruleId,
          engine: "runtime",
          run: false,
          verdict: "unknown",
          reason: `a copy of Taskless rule ${SOURCE}, not issued by the rule service for this repository, so it runs only with --dangerously-run-scripts`,
        },
      ]);
      expect(plan.integrity[0]).toMatchObject({
        verdict: "unknown",
        copyOf: { ruleId: SOURCE, sourceMissing: false },
      });
    });

    it("a runtime rename is one notice in place of the missing warning, and does not fail", () => {
      const plan = applyVerdicts(
        [RT],
        {
          rules: [{ ...missingSource, engine: "runtime" }],
          unknown: [{ ruleId: RT.ruleId, copyOf: COPY_OF }],
          entitlement: entitled,
        },
        recovery
      );
      expect(plan.failures).toEqual([]);
      expect(plan.notices).toEqual([
        `runtime rule ${RT.ruleId} is a copy of Taskless rule ${SOURCE}, which was deleted (changed .vale.ini), so it did not run. Run \`${restore(SOURCE)}\` to put back the issued rule, then delete .taskless/rules/runtime/${RT.ruleId}/.`,
      ]);
    });

    it("copyOf: null is a local rule, as if absent", () => {
      const plan = applyVerdicts(
        [SG],
        {
          rules: [],
          unknown: [{ ruleId: SG.ruleId, copyOf: null }],
          entitlement: entitled,
        },
        recovery
      );
      expect(plan.dispositions).toMatchObject([{ run: true }]);
      expect(plan.failures).toEqual([]);
    });

    it.each([
      ["a string", "no-simply-00000000"],
      ["an object without ruleId", { revisionId: "r7", files: [] }],
      ["an empty ruleId", { ruleId: "" }],
    ])(
      "a copyOf that is %s fails closed: the rule does not run and the run fails",
      (_label, copyOf) => {
        for (const rule of [SG, RT]) {
          const plan = applyVerdicts(
            [rule],
            {
              rules: [],
              unknown: [{ ruleId: rule.ruleId, copyOf }],
              entitlement: entitled,
            },
            recovery
          );
          expect(plan.dispositions).toMatchObject([
            { run: false, verdict: "unaccounted" },
          ]);
          expect(plan.failures[0]).toContain(
            "marked it as a copy of an issued rule without saying which"
          );
          expect(plan.integrity).toEqual([
            {
              ruleId: rule.ruleId,
              engine: rule.engine,
              verdict: "unaccounted",
            },
          ]);
        }
      }
    );
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
      recovery
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
      recovery
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
      recovery
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
      recovery
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
      recovery
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
      recovery
    );
    expect(plan.dispositions).toMatchObject([{ run: false }]);
    expect(plan.failures).toHaveLength(1);
  });

  it("a malformed body accounts for nothing, so every reported rule fails", () => {
    const plan = applyVerdicts([SG, RT], "not an object", recovery);
    expect(plan.dispositions.every((d) => !d.run)).toBe(true);
    expect(plan.failures).toHaveLength(2);
  });
});

describe("recoveryAdvice", () => {
  const target = {
    ruleId: "no-eval-3fa9c21b",
    engine: "sg" as const,
    purpose: "put back the issued version",
  };

  it.each([true, undefined])(
    "names rule restore when restoreRules is %s",
    (restoreRules) => {
      expect(recoveryAdvice(restoreRules, restore)(target)).toBe(
        "Run `taskless rule restore no-eval-3fa9c21b` to put back the issued version."
      );
    }
  );

  it("gives the git steps for the rule's directory when restoreRules is false", () => {
    expect(recoveryAdvice(false, restore)(target)).toBe(
      "Restoring rules is not included in your organization's plan, so recover no-eval-3fa9c21b from git: " +
        "`git log -- .taskless/rules/sg/no-eval-3fa9c21b/` lists the commits that changed it, and " +
        "`git restore --source=<commit> -- .taskless/rules/sg/no-eval-3fa9c21b/` puts it back as of one of them."
    );
  });

  it("widens to a quoted any-engine pathspec when the engine is unknown", () => {
    const sentence = recoveryAdvice(
      false,
      restore
    )({
      ruleId: "gone-3fa9c21b",
      purpose: "bring it back",
    });
    expect(sentence).toContain(
      "`git log -- '.taskless/rules/*/gone-3fa9c21b/*'`"
    );
  });

  it("keeps afterwards and otherwise as sentences of their own", () => {
    const sentence = recoveryAdvice(
      false,
      restore
    )({
      ...target,
      afterwards: "delete .taskless/rules/vale/bar-2/",
      otherwise: "ignore this if it was removed on purpose",
    });
    expect(sentence).toMatch(
      / Then delete \.taskless\/rules\/vale\/bar-2\/\. Or ignore this if it was removed on purpose\.$/
    );
  });
});

describe("applyVerdicts on a plan without rule recovery", () => {
  const noRecovery = recoveryAdvice(false, restore);
  const GIT = "Restoring rules is not included in your organization's plan";

  it("an unsafe static rule fails with git steps, not rule restore", () => {
    const plan = applyVerdicts(
      [VALE],
      {
        rules: [
          {
            ruleId: VALE.ruleId,
            engine: "vale",
            verdict: "unsafe",
            files: [{ path: ".vale.ini", expected: "e", got: "g" }],
          },
        ],
        unknown: [],
        entitlement: entitled,
      },
      noRecovery
    );
    expect(plan.failures).toHaveLength(1);
    expect(plan.failures[0]).toContain(GIT);
    expect(plan.failures[0]).toContain(
      `git log -- .taskless/rules/vale/${VALE.ruleId}/`
    );
    expect(plan.failures[0]).not.toContain("rule restore");
  });

  it("an unsafe runtime rule's notice gives git steps, not rule restore", () => {
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
      noRecovery
    );
    expect(plan.notices[0]).toContain(
      `git log -- .taskless/rules/runtime/${RT.ruleId}/`
    );
    expect(plan.notices[0]).not.toContain("rule restore");
  });

  it.each([
    ["sg", ".taskless/rules/sg/gone-3fa9c21b/"],
    [undefined, "'.taskless/rules/*/gone-3fa9c21b/*'"],
  ])(
    "a missing rule (engine %s) gets git steps and may still be ignored",
    (engine, directory) => {
      const plan = applyVerdicts(
        [],
        {
          rules: [
            {
              ruleId: "gone-3fa9c21b",
              ...(engine === undefined ? {} : { engine }),
              verdict: "missing",
              revisionId: "r9",
            },
          ],
          unknown: [],
          entitlement: entitled,
        },
        noRecovery
      );
      expect(plan.notices).toHaveLength(1);
      expect(plan.notices[0]).toContain(`git log -- ${directory}`);
      expect(plan.notices[0]).toContain(
        "Or ignore this if it was removed on purpose."
      );
      expect(plan.notices[0]).not.toContain("rule restore");
    }
  );

  it("a rename gives git steps for the source, then says to delete the copy", () => {
    const SOURCE = "no-simply-00000000";
    const plan = applyVerdicts(
      [VALE],
      {
        rules: [
          {
            ruleId: SOURCE,
            engine: "vale",
            verdict: "missing",
            revisionId: "r8",
          },
        ],
        unknown: [
          {
            ruleId: VALE.ruleId,
            copyOf: {
              ruleId: SOURCE,
              revisionId: "r7",
              files: [{ path: ".vale.ini", expected: "e", got: "g" }],
            },
          },
        ],
        entitlement: entitled,
      },
      noRecovery
    );
    expect(plan.failures).toEqual([
      `vale rule ${VALE.ruleId} is a copy of Taskless rule ${SOURCE}, which was deleted (changed .vale.ini), so it did not run and \`check\` fails. ` +
        `${GIT}, so recover ${SOURCE} from git: ` +
        `\`git log -- .taskless/rules/vale/${SOURCE}/\` lists the commits that changed it, and ` +
        `\`git restore --source=<commit> -- .taskless/rules/vale/${SOURCE}/\` puts it back as of one of them. ` +
        `Then delete .taskless/rules/vale/${VALE.ruleId}/.`,
    ]);
    expect(plan.notices).toEqual([]);
  });
});
