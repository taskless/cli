import { describe, expect, it } from "vitest";

import { findSgTraps } from "../src/rules/sg-traps";

/** A TypeScript rule around the given `rule:` body. */
function typescript(rule: unknown, language = "TypeScript") {
  return {
    id: "probe",
    language,
    severity: "error",
    message: "m",
    rule,
  };
}

describe("$$$ beside a comma", () => {
  it("notices the trailing form in a plain pattern", () => {
    const notices = findSgTraps(typescript({ pattern: "foo($A, $$$)" }));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("foo($A, $$$)");
    expect(notices[0]).toContain("strictness: ast");
  });

  it("is silent when the pattern object already declares strictness: ast", () => {
    const notices = findSgTraps(
      typescript({
        pattern: {
          context: "foo($A, $$$)",
          selector: "call_expression",
          strictness: "ast",
        },
      })
    );
    expect(notices).toEqual([]);
  });

  // The mirror case: the recipe says `strictness: ast` does not rescue it, so
  // declaring it must not silence the notice.
  it("notices the leading form even under strictness: ast", () => {
    const notices = findSgTraps(
      typescript({
        pattern: {
          context: "foo($$$REST, $LAST)",
          selector: "call_expression",
          strictness: "ast",
        },
      })
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("any");
  });

  // Two traps with different remedies in one pattern. Returning after the
  // first would leave an author who fixes the leading form with no word of the
  // trailing one.
  it("notices both forms when one pattern holds both", () => {
    const notices = findSgTraps(
      typescript({ pattern: "foo($$$HEAD, $A, $$$TAIL)" })
    );
    expect(notices).toHaveLength(2);
    expect(notices.some((notice) => notice.includes("any"))).toBe(true);
    expect(notices.some((notice) => notice.includes("strictness: ast"))).toBe(
      true
    );
  });

  it("is silent for a standalone $$$", () => {
    expect(findSgTraps(typescript({ pattern: "foo($$$)" }))).toEqual([]);
  });

  it("finds a pattern nested inside a relation", () => {
    const notices = findSgTraps(
      typescript({
        kind: "expression_statement",
        has: { pattern: "foo($A, $$$)" },
      })
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("rule.has.pattern");
  });
});

describe("a sibling relation without stopBy", () => {
  it("notices follows with no stopBy", () => {
    const notices = findSgTraps(
      typescript({ kind: "number", follows: { kind: "number" } })
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("follows");
    expect(notices[0]).toContain("stopBy: end");
  });

  it("notices precedes the same way", () => {
    const notices = findSgTraps(
      typescript({ kind: "number", precedes: { kind: "number" } })
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("precedes");
  });

  it("is silent once stopBy is declared", () => {
    expect(
      findSgTraps(
        typescript({
          kind: "number",
          follows: { kind: "number", stopBy: "end" },
        })
      )
    ).toEqual([]);
  });
});

describe("an awaited generic call hides its callee", () => {
  const plain = {
    kind: "call_expression",
    has: { field: "function", kind: "identifier", regex: "^rpc$" },
  };

  it("notices a callee regex under TypeScript", () => {
    const notices = findSgTraps(typescript(plain));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("await_expression");
  });

  it("notices it under Tsx", () => {
    expect(findSgTraps(typescript(plain, "Tsx"))).toHaveLength(1);
  });

  it("is silent under any other language", () => {
    expect(findSgTraps(typescript(plain, "JavaScript"))).toEqual([]);
  });

  it("notices a method callee", () => {
    const notices = findSgTraps(
      typescript({
        kind: "call_expression",
        has: {
          field: "function",
          kind: "member_expression",
          has: {
            field: "property",
            kind: "property_identifier",
            regex: "^rpc$",
          },
        },
      })
    );
    expect(notices).toHaveLength(1);
  });

  // The two workarounds `create-sg-rule` recommends, verbatim. A detector that
  // flagged the recipe's own fix would teach authors to ignore it.
  it("is silent for the recipe's function workaround", () => {
    expect(
      findSgTraps(
        typescript({
          kind: "call_expression",
          has: {
            field: "function",
            any: [
              { kind: "identifier", regex: "^rpc$" },
              {
                kind: "await_expression",
                has: { kind: "identifier", regex: "^rpc$" },
              },
            ],
          },
        })
      )
    ).toEqual([]);
  });

  it("is silent for the recipe's method workaround", () => {
    expect(
      findSgTraps(
        typescript({
          kind: "call_expression",
          has: {
            field: "function",
            any: [
              {
                kind: "member_expression",
                has: {
                  field: "property",
                  kind: "property_identifier",
                  regex: "^rpc$",
                },
              },
              {
                kind: "await_expression",
                has: {
                  kind: "member_expression",
                  has: {
                    field: "property",
                    kind: "property_identifier",
                    regex: "^rpc$",
                  },
                },
              },
            ],
          },
        })
      )
    ).toEqual([]);
  });

  it("is silent when the callee is matched without a regex", () => {
    expect(
      findSgTraps(
        typescript({
          kind: "call_expression",
          has: { field: "function", pattern: "rpc" },
        })
      )
    ).toEqual([]);
  });
});

describe("a rule with none of the traps", () => {
  it("carries no notices", () => {
    expect(findSgTraps(typescript({ pattern: "eval($ARG)" }))).toEqual([]);
  });
});
