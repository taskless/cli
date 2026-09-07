import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The route decision is made by an agent following help/route.md, so this
// dataset is not run against a code classifier. The test guards the dataset
// itself: it must stay structurally valid and balanced across every route and
// both failure directions, so it remains a usable calibration set.

interface EvalCase {
  request: string;
  expected: string;
  trap: string | null;
  reason: string;
}

interface EvalFixtures {
  routes: string[];
  traps: string[];
  cases: EvalCase[];
}

const fixtures = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "fixtures/route-eval.json"), "utf8")
) as EvalFixtures;

const casesForTrap = (trap: string): EvalCase[] =>
  fixtures.cases.filter((c) => c.trap === trap);

describe("route honesty eval fixtures", () => {
  it("declares the three routes and both failure-direction traps", () => {
    expect(fixtures.routes).toEqual(["existing", "static", "remote"]);
    // Over-claim = Taskless grabbing a packaged/formatter job; over-escalate =
    // sending a locally-solvable request to the login-gated service.
    expect(fixtures.traps).toEqual(
      expect.arrayContaining(["over-claim", "over-escalate", "under-engage"])
    );
  });

  it("every case is well-formed and uses a declared route/trap", () => {
    expect(fixtures.cases.length).toBeGreaterThanOrEqual(10);
    for (const c of fixtures.cases) {
      expect(c.request.length).toBeGreaterThan(0);
      expect(c.reason.length).toBeGreaterThan(0);
      expect(fixtures.routes).toContain(c.expected);
      if (c.trap !== null) {
        expect(fixtures.traps).toContain(c.trap);
      }
    }
  });

  it("covers every route at least twice", () => {
    for (const route of fixtures.routes) {
      const count = fixtures.cases.filter((c) => c.expected === route).length;
      expect(count, `route ${route} needs >= 2 cases`).toBeGreaterThanOrEqual(
        2
      );
    }
  });

  it("guards every declared trap with at least one correctly-routed case", () => {
    // Each declared trap must have at least one case, so the dataset can't
    // silently stop covering a failure direction while the test still passes.
    for (const trap of fixtures.traps) {
      expect(
        casesForTrap(trap).length,
        `trap ${trap} needs >= 1 case`
      ).toBeGreaterThan(0);
    }

    // Over-claim: Taskless should not have grabbed it → expect `existing`.
    for (const c of casesForTrap("over-claim"))
      expect(c.expected).toBe("existing");
    // Over-escalate: locally solvable → expect `static`, not remote.
    for (const c of casesForTrap("over-escalate"))
      expect(c.expected).toBe("static");
    // Under-engage: naming a tool must engage routing into that linter, not
    // suppress → expect `existing`.
    for (const c of casesForTrap("under-engage"))
      expect(c.expected).toBe("existing");
  });

  it("includes genuine remote cases that are not locally solvable", () => {
    const remote = fixtures.cases.filter((c) => c.expected === "remote");
    expect(remote.length).toBeGreaterThanOrEqual(2);
    // Genuine remote cases are clean (no trap) — they legitimately need the
    // service, not a misroute being corrected.
    expect(remote.every((c) => c.trap === null)).toBe(true);
  });
});
