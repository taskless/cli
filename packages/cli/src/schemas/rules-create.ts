import { z } from "zod";

/** Input schema for `taskless rule create --from` JSON file */
export const inputSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, "prompt must be a non-empty string")
    .describe("Description of the rule to generate"),
  successCases: z
    .array(z.string())
    .optional()
    .describe("Examples of correct code that should pass the rule"),
  failureCases: z
    .array(z.string())
    .optional()
    .describe("Examples of incorrect code that should fail the rule"),
});

/** Output schema for `taskless rule create --json` on success */
export const outputSchema = z.object({
  success: z.literal(true),
  requestId: z
    .string()
    .describe(
      "The generation request's id. Not a rule id: nothing takes it back as one"
    ),
  rules: z
    .array(z.string())
    .describe(
      "Ids of the rules that were written: each rule's directory name under `.taskless/rules/<engine>/`, which is what `rule improve`, `rule restore`, and `rule rollback` take"
    ),
  files: z.array(z.string()).describe("File paths that were written"),
  notices: z
    .array(z.string())
    .optional()
    .describe(
      "Advisory messages about a delivery that was still written — a rule delivered with no `.tests/` fixtures above all. Present only when there is something to say. A machine consumer cannot read stderr prose, so these are carried here rather than only printed"
    ),
});

/** Error schema for `taskless rule create --json` on failure */
export const errorSchema = z.object({
  error: z.string().describe("Error message"),
});
