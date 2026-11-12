import { describe, expect, it } from "vitest";
import { z } from "zod";

import upstreamSchema from "../src/generated/ast-grep-rule-schema.json";
import {
  astGrepRuleJsonSchema,
  astGrepRuleSchema,
  findRegexWithoutKind,
} from "../src/schemas/ast-grep-rule";

/**
 * The regex/kind pairing (`sg-regex-needs-kind`), stated once in the JSON
 * Schema and mirrored by the zod check `validate` runs. See taskless/cli#671.
 */

const BASE = {
  id: "probe",
  language: "TypeScript",
  severity: "error",
  message: "probe",
};

/** The dotted paths `validate` would refuse, for a rule file body. */
function refused(file: Record<string, unknown>): string[] {
  return findRegexWithoutKind({ ...BASE, ...file }).map(({ path }) =>
    path.join(".")
  );
}

describe("findRegexWithoutKind", () => {
  it("accepts a regex with a sibling kind", () => {
    expect(refused({ rule: { kind: "identifier", regex: "^a$" } })).toEqual([]);
  });

  it("refuses a regex at the top of `rule`", () => {
    expect(refused({ rule: { regex: "^a$" } })).toEqual(["rule"]);
  });

  it("refuses a regex inside `constraints.<VAR>`", () => {
    expect(
      refused({
        rule: { pattern: "foo($A)" },
        constraints: { A: { regex: "^a$" } },
      })
    ).toEqual(["constraints.A"]);
  });

  it("refuses a regex inside `utils.<name>`", () => {
    expect(
      refused({
        rule: { matches: "is-a" },
        utils: { "is-a": { regex: "^a$" } },
      })
    ).toEqual(["utils.is-a"]);
  });

  it("refuses a regex inside `not`", () => {
    expect(
      refused({ rule: { kind: "identifier", not: { regex: "^a$" } } })
    ).toEqual(["rule.not"]);
  });

  it("refuses a regex in nested `has` and `inside` sub-rules", () => {
    expect(
      refused({
        rule: {
          kind: "call_expression",
          has: {
            field: "function",
            kind: "member_expression",
            has: { regex: "^rpc$" },
          },
          inside: { regex: "^async" },
        },
      })
    ).toEqual(["rule.has.has", "rule.inside"]);
  });

  it("refuses a regex in `precedes`, `follows`, and `any`/`all` items", () => {
    expect(
      refused({
        rule: {
          kind: "identifier",
          precedes: { regex: "a" },
          follows: { regex: "b" },
          any: [{ kind: "x" }, { regex: "c" }],
          all: [{ kind: "x" }, { regex: "d" }],
        },
      })
    ).toEqual(["rule.precedes", "rule.follows", "rule.any.1", "rule.all.1"]);
  });

  it("reaches every other rule position the schema allows", () => {
    expect(
      refused({
        rule: {
          kind: "identifier",
          has: { kind: "x", stopBy: { regex: "a" } },
          nthChild: { position: 1, ofRule: { regex: "b" } },
          matches: { "util-call": { ARG: { regex: "c" } } },
        },
        fix: { template: "", expandEnd: { regex: "d" } },
        rewriters: [{ id: "rw", rule: { regex: "e" } }],
      })
    ).toEqual([
      "rule.has.stopBy",
      "rule.nthChild.ofRule",
      "rule.matches.util-call.ARG",
      "fix.expandEnd",
      "rewriters.0.rule",
    ]);
  });

  describe("kind supplied through a sibling `any` or `all`", () => {
    it("accepts a sibling `any` whose every branch pins a kind", () => {
      expect(
        refused({
          rule: { pattern: "foo($X)" },
          constraints: {
            X: {
              any: [{ kind: "identifier" }, { kind: "property_identifier" }],
              regex: "^rpc$",
            },
          },
        })
      ).toEqual([]);
    });

    it("refuses a sibling `any` with a branch that pins no kind", () => {
      expect(
        refused({
          rule: { pattern: "foo($X)" },
          constraints: {
            X: {
              any: [{ kind: "identifier" }, { pattern: "$A.$B" }],
              regex: "^rpc$",
            },
          },
        })
      ).toEqual(["constraints.X"]);
    });

    it("refuses an empty sibling `any`", () => {
      expect(refused({ rule: { any: [], regex: "^a$" } })).toEqual(["rule"]);
    });

    it("accepts a sibling `all` with one branch that pins a kind", () => {
      expect(
        refused({
          rule: {
            all: [{ pattern: "$A" }, { kind: "identifier" }],
            regex: "a",
          },
        })
      ).toEqual([]);
    });

    it("accepts kinds pinned through nested `any`/`all`", () => {
      expect(
        refused({
          rule: {
            any: [
              { kind: "identifier" },
              { all: [{ has: { kind: "x" } }, { kind: "member_expression" }] },
              { any: [{ kind: "a" }, { kind: "b" }] },
            ],
            regex: "^rpc",
          },
        })
      ).toEqual([]);
    });

    it("does not count a kind inside `not` or a relation", () => {
      expect(
        refused({
          rule: {
            all: [{ not: { kind: "x" } }, { has: { kind: "y" } }],
            regex: "a",
          },
        })
      ).toEqual(["rule"]);
    });
  });
});

describe("astGrepRuleSchema", () => {
  it("reports every unanchored regex as an attributed issue", () => {
    const result = astGrepRuleSchema.safeParse({
      ...BASE,
      rule: { kind: "identifier", has: { regex: "a" } },
      constraints: { A: { regex: "b" } },
    });
    expect(result.success).toBe(false);
    const issues = result.error?.issues ?? [];
    expect(issues.map((issue) => issue.path.join("."))).toEqual([
      "rule.has",
      "constraints.A",
    ]);
    for (const issue of issues) {
      expect(issue.code).toBe("custom");
      expect(issue.message).toMatch(/--debug-query=ast/);
      expect(issue.code === "custom" && issue.params).toEqual({
        constraintId: "sg-regex-needs-kind",
      });
    }
  });

  // zod skips a refinement attached to a schema that already failed, so the
  // pairing must not hang off the upstream schema: a rule with an unrelated
  // mistake would hide its regex problem for a whole extra round.
  it("still reports the pairing when another field fails the schema", () => {
    const result = astGrepRuleSchema.safeParse({
      ...BASE,
      severity: 3,
      rule: { regex: "a" },
    });
    expect(result.success).toBe(false);
    const issues = result.error?.issues ?? [];
    expect(
      issues.map((issue) => [
        issue.path.join("."),
        issue.code,
        issue.code === "custom" ? issue.params : undefined,
      ])
    ).toEqual([
      ["severity", "invalid_union", undefined],
      ["rule", "custom", { constraintId: "sg-regex-needs-kind" }],
    ]);
  });

  it("still reports the pairing when the rule is missing a required field", () => {
    const { language: _language, ...withoutLanguage } = BASE;
    const result = astGrepRuleSchema.safeParse({
      ...withoutLanguage,
      rule: { regex: "a" },
    });
    const issues = result.error?.issues ?? [];
    expect(issues.map((issue) => issue.path.join("."))).toEqual([
      "language",
      "rule",
    ]);
    const last = issues.at(-1);
    expect(last?.code === "custom" && last.params).toEqual({
      constraintId: "sg-regex-needs-kind",
    });
  });

  it("reports upstream schema failures unchanged when no regex is involved", () => {
    const upstream = z
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      .fromJSONSchema(upstreamSchema as any);
    for (const input of [
      { ...BASE, severity: 3, rule: { kind: "identifier" } },
      { ...BASE, rule: { kind: 3 } },
      { id: "probe", rule: { kind: "identifier" } },
    ]) {
      const result = astGrepRuleSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(
        upstream.safeParse(input).error?.issues
      );
    }
  });

  it("refuses input that is not a rule object at all", () => {
    for (const input of [undefined, null, "rule", []]) {
      expect(astGrepRuleSchema.safeParse(input).success).toBe(false);
    }
  });

  it("returns the rule unchanged when it passes", () => {
    const rule = { ...BASE, rule: { kind: "identifier", regex: "^a$" } };
    expect(astGrepRuleSchema.parse(rule)).toEqual(rule);
  });

  it("accepts a regex anchored by a sibling `any` of kinds", () => {
    expect(
      astGrepRuleSchema.safeParse({
        ...BASE,
        rule: { any: [{ kind: "a" }, { kind: "b" }], regex: "x" },
      }).success
    ).toBe(true);
  });
});

describe("astGrepRuleJsonSchema", () => {
  const definitions = astGrepRuleJsonSchema.$defs as Record<
    string,
    Record<string, unknown>
  >;

  it("states the pairing on every rule definition", () => {
    for (const name of ["SerializableRule", "Relation"]) {
      expect(definitions[name]?.if).toEqual({ required: ["regex"] });
      expect(definitions[name]?.then).toEqual({
        $ref: "#/$defs/TasklessPinsKind",
      });
    }
    expect(definitions.TasklessPinsKind?.description).toMatch(
      /sg-regex-needs-kind/
    );
  });

  it("changes nothing else about the upstream schema", () => {
    const stripped = structuredClone(astGrepRuleJsonSchema) as {
      $defs: Record<string, Record<string, unknown>>;
    };
    delete stripped.$defs.TasklessPinsKind;
    for (const name of ["SerializableRule", "Relation"]) {
      delete stripped.$defs[name]?.if;
      delete stripped.$defs[name]?.then;
    }
    expect(stripped).toEqual(upstreamSchema);
  });
});
