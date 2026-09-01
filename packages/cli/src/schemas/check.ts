import { z } from "zod";

/** Schema for a single check result */
const checkResultSchema = z.object({
  source: z.string().describe("Scanner that produced this result"),
  ruleId: z.string().describe("Rule identifier"),
  severity: z
    .enum(["error", "warning", "info", "hint"])
    .describe("Severity level"),
  message: z.string().describe("Message explaining why the rule fired"),
  note: z.string().nullable().optional().describe("Additional notes"),
  file: z.string().describe("File path where the match was found"),
  range: z.object({
    start: z.object({
      line: z.number(),
      column: z.number(),
    }),
    end: z.object({
      line: z.number(),
      column: z.number(),
    }),
  }),
  matchedText: z.string().describe("The code that matched the rule"),
  fix: z.string().nullable().optional().describe("Suggested fix replacement"),
});

/** A runtime rule that was present but not executed (advisory), for `--json`. */
const skippedRuntimeRuleSchema = z.object({
  rule: z.string().describe("Runtime rule name that did not run"),
  reason: z.string().describe("Why the runtime rule was not run"),
});

/** Output schema for `taskless check --json` on success */
export const outputSchema = z.object({
  success: z.boolean(),
  results: z.array(checkResultSchema).describe("Check results"),
  skipped: z
    .array(skippedRuntimeRuleSchema)
    .optional()
    .describe("Runtime rules present but not executed"),
  // Human output for these is `warn()`, which is a no-op under `--json`. Absent
  // from the envelope, a machine consumer reads `{"success":false,"results":[]}`
  // for a Vale that died and cannot tell it from a clean run.
  failures: z
    .array(z.string())
    .optional()
    .describe("Engines that were present and failed"),
  notices: z
    .array(z.string())
    .optional()
    .describe("Advisory messages: engines that could not run"),
  // `check` migrates `.taskless/` before it can dispatch, and that rewrites
  // files in the working tree. Absent unless it happened, so a consumer reads
  // presence rather than guessing from an empty list.
});

/** Error schema for `taskless check --json` on failure */
export const errorSchema = z.object({
  success: z.literal(false),
  error: z.string().describe("Error message"),
  results: z.array(checkResultSchema).describe("Check results (may be empty)"),
});
