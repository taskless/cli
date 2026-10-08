import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  bugInputSchema,
  generalInputSchema,
  inputSchema,
  ruleInputSchema,
} from "../src/schemas/feedback";

const valid = {
  kind: "rule",
  ruleKind: "ast-grep, forbid eval in TypeScript",
  verbatim: "It worked but the second rule took three tries.",
  completed: "Yes",
};

const validBug = {
  kind: "bug",
  summary: "check exits 0 when a rule file fails to parse",
  trying: "Run taskless check after adding a rule",
  expected: "A non-zero exit naming the broken rule",
  actual: "Exit 0 with no findings",
};

/** The first path segment of each issue, or the unrecognized keys it names. */
function failingFields(payload: unknown): unknown[] {
  const result = inputSchema.safeParse(payload);
  expect(result.success).toBe(false);
  if (result.success) return [];
  return result.error.issues.flatMap((issue) =>
    issue.code === "unrecognized_keys" ? issue.keys : [issue.path[0]]
  );
}

describe("feedback payload schema", () => {
  describe("kind: rule", () => {
    it("accepts the one required answer alone", () => {
      // `skip` at the invite leaves the agent's account and nothing else.
      const parsed = inputSchema.parse({
        kind: "rule",
        ruleKind: "none (onboarding)",
      });
      expect(Object.keys(parsed)).toEqual(["kind", "ruleKind"]);
    });

    it("accepts the optional answers when present", () => {
      const parsed = ruleInputSchema.parse({
        ...valid,
        workedWell: "The verify loop.",
        needsImprovement: "The first draft's language field.",
        agents: "Claude Code",
        mostValuableRule: "no-eval: it caught two uses in the first check.",
      });
      expect(parsed.workedWell).toBe("The verify loop.");
      expect(parsed.agents).toBe("Claude Code");
    });

    it.each(["partially", "yes", "true", ""])(
      "rejects completed: %j, naming the field",
      (completed) => {
        expect(failingFields({ ...valid, completed })).toContain("completed");
      }
    );

    it("rejects a missing ruleKind, naming the field", () => {
      const { ruleKind: _ruleKind, ...rest } = valid;
      expect(failingFields(rest)).toContain("ruleKind");
    });

    it("rejects an optional answer that is present but blank", () => {
      // Blank is not "unanswered": an agent that wrote the key meant to
      // answer. Omitting the key is how a question is left unanswered.
      expect(failingFields({ ...valid, workedWell: "   " })).toContain(
        "workedWell"
      );
    });
  });

  describe("kind: general", () => {
    it("accepts the user's words alone", () => {
      const parsed = inputSchema.parse({
        kind: "general",
        verbatim: "The recipes are long.",
      });
      expect(Object.keys(parsed)).toEqual(["kind", "verbatim"]);
    });

    it("requires the user's words", () => {
      expect(failingFields({ kind: "general", context: "x" })).toContain(
        "verbatim"
      );
    });

    it("rejects a key belonging to another kind, naming it", () => {
      expect(
        failingFields({ kind: "general", verbatim: "x", ruleKind: "y" })
      ).toContain("ruleKind");
    });
  });

  describe("kind: bug", () => {
    it("accepts its four required answers", () => {
      expect(inputSchema.parse(validBug)).toEqual(validBug);
    });

    it.each(["summary", "trying", "expected", "actual"])(
      "requires %s, naming it",
      (key) => {
        const payload: Record<string, string> = { ...validBug };
        delete payload[key];
        expect(failingFields(payload)).toContain(key);
      }
    );

    it("takes no version information from the agent", () => {
      expect(failingFields({ ...validBug, version: "0.11.3" })).toContain(
        "version"
      );
    });
  });

  describe("the kind discriminator", () => {
    it("rejects a payload without a kind, naming kind", () => {
      expect(
        failingFields({ ruleKind: "ast-grep, forbid eval in TypeScript" })
      ).toEqual(["kind"]);
    });

    it("rejects an unknown kind, naming kind", () => {
      expect(failingFields({ kind: "praise", verbatim: "x" })).toEqual([
        "kind",
      ]);
    });

    it.each([
      ["rule", ruleInputSchema],
      ["general", generalInputSchema],
      ["bug", bugInputSchema],
    ] as const)(
      "renders %s's kind as a required single const for the recipe",
      (kind, schema) => {
        const rendered = z.toJSONSchema(schema);
        expect(rendered.required).toContain("kind");
        expect(rendered.properties?.kind).toMatchObject({ const: kind });
      }
    );
  });

  it("never takes a survey key from the agent", () => {
    // The map to question ids is the CLI's. Every branch is strict, so a
    // payload that tries to carry one is rejected outright.
    expect(
      failingFields({
        ...valid,
        "$survey_response_2c3c80dc-dcda-4e29-b52e-a25ef58b5ca2": "smuggled",
      })
    ).toContain("$survey_response_2c3c80dc-dcda-4e29-b52e-a25ef58b5ca2");
  });
});
