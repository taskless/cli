import { z } from "zod";

import { COMPLETED_CHOICES, FEEDBACK_KINDS } from "../survey/constants";

/**
 * Input schema for `taskless feedback send --from` JSON file.
 *
 * Human keys only. The map to each survey's question identifiers lives in
 * `src/survey/constants.ts`, and a payload never carries a `$survey_*` key.
 *
 * `kind` is the discriminator: a required literal on every branch, never
 * defaulted. Each branch is strict, so a key belonging to another kind fails
 * naming that key instead of being dropped on the way to the event. Each
 * recipe embeds only its own branch, so the agent reading `bug-report` never
 * sees the rule survey's keys.
 */

/** An answer the payload must carry. */
function requiredAnswer(key: string, description: string) {
  return z
    .string()
    .trim()
    .min(1, `${key} must be a non-empty string`)
    .describe(description);
}

/**
 * An answer the payload may leave out. Blank is not "unanswered": an agent
 * that wrote the key meant to answer, and omitting the key is how a question
 * is left unanswered.
 */
function optionalAnswer(key: string, description: string) {
  return z
    .string()
    .trim()
    .min(1, `${key}, when present, must be non-empty`)
    .optional()
    .describe(description);
}

/** The invited survey about rule authoring and onboarding. */
export const ruleInputSchema = z.strictObject({
  kind: z.literal("rule").describe("Always `rule` for this survey"),
  ruleKind: requiredAnswer(
    "ruleKind",
    "The kind of rule the user was trying to create: the engine and what the rule was for. `none (onboarding)` on the onboarding path"
  ),
  verbatim: z
    .string()
    .trim()
    .min(1, "verbatim, when present, must be the user's own words, non-empty")
    .optional()
    .describe(
      "The user's reply, in their own words, unedited. Omit when they gave none"
    ),
  completed: z
    .enum(COMPLETED_CHOICES, {
      error: `completed must be one of ${COMPLETED_CHOICES.map((choice) => `"${choice}"`).join(", ")}`,
    })
    .optional()
    .describe(
      "Whether the user completed the task, in your opinion. Success is binary; use Unknown when you cannot tell"
    ),
  workedWell: optionalAnswer(
    "workedWell",
    "Steps of the interaction with Taskless that worked well"
  ),
  needsImprovement: optionalAnswer(
    "needsImprovement",
    "Steps of the interaction with Taskless that could use improvement"
  ),
  agents: optionalAnswer(
    "agents",
    "The open-source, publicly available agent(s) or framework(s) the user is working through, including the one running this recipe"
  ),
  mostValuableRule: optionalAnswer(
    "mostValuableRule",
    "Of the rules created so far, the one creating the most value for the team and why. Omit when there are no rules or you cannot tell"
  ),
});

/** Feedback the user chose to give about Taskless. */
export const generalInputSchema = z.strictObject({
  kind: z.literal("general").describe("Always `general` for this survey"),
  verbatim: requiredAnswer(
    "verbatim",
    "The user's feedback, in their own words, unedited"
  ),
  context: optionalAnswer(
    "context",
    "What led to the feedback, from what you observed in the session, as the user approved it. Omit when there is nothing to add"
  ),
});

/**
 * A bug report. The survey's version-information question has no key here:
 * the CLI answers it itself, so the agent can neither get it wrong nor leave
 * it out.
 */
export const bugInputSchema = z.strictObject({
  kind: z.literal("bug").describe("Always `bug` for this survey"),
  summary: requiredAnswer("summary", "A one-line summary of the bug"),
  trying: requiredAnswer("trying", "What the user was trying to do"),
  expected: requiredAnswer("expected", "The result the user expected"),
  actual: requiredAnswer("actual", "The result the user actually got"),
  context: optionalAnswer(
    "context",
    "Anything else that would help fix it: the command run, the error text, the steps to reproduce. Omit when there is nothing to add"
  ),
});

export const inputSchema = z.discriminatedUnion(
  "kind",
  [ruleInputSchema, generalInputSchema, bugInputSchema],
  {
    // Zod's own message for a missing or unknown discriminator is "Invalid
    // input", which tells the agent nothing about what to write.
    error: `kind must be one of ${FEEDBACK_KINDS.map((kind) => `"${kind}"`).join(", ")}`,
  }
);

export type FeedbackInput = z.infer<typeof inputSchema>;
