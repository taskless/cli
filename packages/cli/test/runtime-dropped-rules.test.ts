import { describe, expect, it } from "vitest";

import { accountForDroppedRules } from "../src/rules/runtime/plan";
import type { RuntimeRule } from "../src/rules/runtime/discover";

/**
 * A rule is identified by `name` here, which is all the accounting reads. The
 * rest of a `RuntimeRule` is irrelevant to the question this helper answers,
 * so the casts keep the fixtures to the field under test.
 */
function rule(name: string): RuntimeRule {
  return { name } as unknown as RuntimeRule;
}

describe("accounting for blessed rules that never ran", () => {
  it("reports a rule that was blessed but is absent from the executed set", () => {
    // The silent case. The server blessed it, so it is not `withheld`;
    // re-discovery dropped it, so it is not in `execute`. Before this, it
    // appeared in neither list and `check` exited 0 having said nothing.
    const skipped = accountForDroppedRules(
      [rule("env-read"), rule("logs-write")],
      [rule("env-read")]
    );

    expect(skipped).toEqual([
      {
        rule: "logs-write",
        reason: "blessed by the server but missing after materialization",
      },
    ]);
  });

  it("reports nothing when every blessed rule survived", () => {
    expect(
      accountForDroppedRules(
        [rule("env-read"), rule("logs-write")],
        [rule("env-read"), rule("logs-write")]
      )
    ).toEqual([]);
  });

  it("reports nothing when nothing was blessed", () => {
    expect(accountForDroppedRules([], [])).toEqual([]);
  });

  it("does not report a rule that appeared without being blessed", () => {
    // The asymmetry is deliberate. This helper answers "what did we promise to
    // run and then not run"; an unexpected EXTRA rule in the executed set is a
    // different question, and reporting it here as skipped would be false.
    expect(
      accountForDroppedRules(
        [rule("env-read")],
        [rule("env-read"), rule("surprise")]
      )
    ).toEqual([]);
  });
});
