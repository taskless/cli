import { z } from "zod";

/** Output schema for `taskless rule restore --json` and `rule rollback --json` on success */
export const outputSchema = z.object({
  success: z.literal(true),
  ruleId: z
    .string()
    .describe(
      "The rule's id: its directory name under `.taskless/rules/<engine>/`"
    ),
  revisionId: z
    .string()
    .optional()
    .describe(
      "The revision now on disk. Absent when nothing was written because the rule was already intact"
    ),
  files: z
    .array(z.string())
    .describe("The rule file written; empty when nothing needed restoring"),
  notices: z
    .array(z.string())
    .optional()
    .describe(
      "What happened, and anything worth saying about a rule that was written: that it will not run on the current plan above all"
    ),
});
