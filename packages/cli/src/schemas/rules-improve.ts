import { z } from "zod";

/** Input schema for `taskless rule improve --from` JSON file */
export const inputSchema = z.object({
  ruleId: z
    .string()
    .trim()
    .min(1, "ruleId must be a non-empty string")
    .describe("ID of the rule to improve"),
  guidance: z
    .string()
    .trim()
    .min(1, "guidance must be a non-empty string")
    .describe("Feedback for iterating on the existing rule"),
  references: z
    .array(
      z.object({
        filename: z.string().describe("File path relative to .taskless/"),
        content: z.string().describe("File content"),
      })
    )
    .optional()
    .describe("Reference files to include as context"),
});

/** Output schema for `taskless rule improve --json` on success */
export const outputSchema = z.object({
  success: z.literal(true),
  requestId: z.string().describe("The request ID for polling status"),
  rules: z.array(z.string()).describe("Rule IDs that were updated"),
  files: z.array(z.string()).describe("File paths that were written"),
  notices: z
    .array(z.string())
    .optional()
    .describe(
      "Advisory messages about a delivery that was still written — a rule delivered with no `.tests/` fixtures above all. Present only when there is something to say. A machine consumer cannot read stderr prose, so these are carried here rather than only printed"
    ),
});

/** Error schema for `taskless rule improve --json` on failure */
export const errorSchema = z.object({
  error: z.string().describe("Error message"),
});
