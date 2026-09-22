import { describe, expect, it } from "vitest";

import { inputSchema } from "../src/schemas/feedback";

const valid = {
  ruleKind: "ast-grep, forbid eval in TypeScript",
  verbatim: "It worked but the second rule took three tries.",
  completed: "Yes",
};

describe("feedback payload schema", () => {
  it("accepts the one required answer alone", () => {
    // `skip` at the invite leaves the agent's account and nothing else.
    const parsed = inputSchema.parse({ ruleKind: "none (onboarding)" });
    expect(parsed.verbatim).toBeUndefined();
    expect(parsed.completed).toBeUndefined();
    expect(Object.keys(parsed)).toEqual(["ruleKind"]);
  });

  it("accepts the optional answers when present", () => {
    const parsed = inputSchema.parse({
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
      const result = inputSchema.safeParse({ ...valid, completed });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((issue) => issue.path[0])).toContain(
        "completed"
      );
    }
  );

  it("rejects a missing ruleKind, naming the field", () => {
    const { ruleKind: _ruleKind, ...rest } = valid;
    const result = inputSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path[0])).toContain(
      "ruleKind"
    );
  });

  it("rejects an optional answer that is present but blank", () => {
    // Blank is not "unanswered": an agent that wrote the key meant to answer.
    // Omitting the key is how a question is left unanswered.
    const result = inputSchema.safeParse({ ...valid, workedWell: "   " });
    expect(result.success).toBe(false);
  });

  it("never takes a survey key from the agent", () => {
    // The map to question ids is the CLI's. A payload that tries to carry one
    // is not rejected (zod strips unknown keys), and the stripped key never
    // reaches the event; feedback-command.test.ts asserts the event shape.
    const parsed = inputSchema.parse({
      ...valid,
      "$survey_response_2c3c80dc-dcda-4e29-b52e-a25ef58b5ca2": "smuggled",
    });
    expect(Object.keys(parsed)).not.toContain(
      "$survey_response_2c3c80dc-dcda-4e29-b52e-a25ef58b5ca2"
    );
  });
});
