import { describe, expect, it } from "vitest";

import { inputSchema } from "../src/schemas/feedback";

const valid = {
  verbatim: "It worked but the second rule took three tries.",
  goal: "Add an ast-grep rule that forbids eval",
  completed: "Yes",
};

describe("feedback payload schema", () => {
  it("accepts the three required answers alone", () => {
    const parsed = inputSchema.parse(valid);
    expect(parsed.workedWell).toBeUndefined();
    expect(parsed.needsImprovement).toBeUndefined();
  });

  it("accepts the optional answers when present", () => {
    const parsed = inputSchema.parse({
      ...valid,
      workedWell: "The verify loop.",
      needsImprovement: "The first draft's language field.",
    });
    expect(parsed.workedWell).toBe("The verify loop.");
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

  it("rejects a missing verbatim, naming the field", () => {
    const { verbatim: _verbatim, ...rest } = valid;
    const result = inputSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path[0])).toContain(
      "verbatim"
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
      "$survey_response_5feff6a3-6768-4817-92d7-5ae3975c6baa": "smuggled",
    });
    expect(Object.keys(parsed)).not.toContain(
      "$survey_response_5feff6a3-6768-4817-92d7-5ae3975c6baa"
    );
  });
});
