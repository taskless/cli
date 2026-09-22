import { z } from "zod";

import { COMPLETED_CHOICES } from "../survey/constants";

/**
 * Input schema for `taskless feedback send --from` JSON file.
 *
 * Human keys only. The map to the survey's question identifiers lives in
 * `src/survey/constants.ts`, and a payload never carries a `$survey_*` key.
 */
export const inputSchema = z.object({
  ruleKind: z
    .string()
    .trim()
    .min(1, "ruleKind must be a non-empty string")
    .describe(
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
  workedWell: z
    .string()
    .trim()
    .min(1, "workedWell, when present, must be non-empty")
    .optional()
    .describe("Steps of the interaction with Taskless that worked well"),
  needsImprovement: z
    .string()
    .trim()
    .min(1, "needsImprovement, when present, must be non-empty")
    .optional()
    .describe(
      "Steps of the interaction with Taskless that could use improvement"
    ),
  agents: z
    .string()
    .trim()
    .min(1, "agents, when present, must be non-empty")
    .optional()
    .describe(
      "The open-source, publicly available agent(s) or framework(s) the user is working through, including the one running this recipe"
    ),
  mostValuableRule: z
    .string()
    .trim()
    .min(1, "mostValuableRule, when present, must be non-empty")
    .optional()
    .describe(
      "Of the rules created so far, the one creating the most value for the team and why. Omit when there are no rules or you cannot tell"
    ),
});

export type FeedbackInput = z.infer<typeof inputSchema>;
