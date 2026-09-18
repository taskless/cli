import { z } from "zod";

import { COMPLETED_CHOICES } from "../survey/constants";

/**
 * Input schema for `taskless feedback send --from` JSON file.
 *
 * Human keys only. The map to the survey's question identifiers lives in
 * `src/survey/constants.ts`, and a payload never carries a `$survey_*` key.
 */
export const inputSchema = z.object({
  verbatim: z
    .string()
    .trim()
    .min(1, "verbatim must be the user's own words, non-empty")
    .describe("The user's reply, in their own words, unedited"),
  goal: z
    .string()
    .trim()
    .min(1, "goal must be a non-empty string")
    .describe("What the user was trying to accomplish, in your words"),
  completed: z
    .enum(COMPLETED_CHOICES, {
      error: `completed must be one of ${COMPLETED_CHOICES.map((choice) => `"${choice}"`).join(", ")}`,
    })
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
});

export type FeedbackInput = z.infer<typeof inputSchema>;
