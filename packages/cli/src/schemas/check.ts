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
    .describe(
      "Why the run failed besides findings: engines that were present and failed, and rules that were edited, unaccounted for, or collide"
    ),
  notices: z
    .array(z.string())
    .optional()
    .describe("Advisory messages: engines that could not run"),
  // Present only when reconcile answered for a plan without runtime rules. A
  // non-empty `withheld` is why `success` is false on a run with no findings,
  // and the one field that tells a CI job the fix is the plan, not the code.
  entitlement: z
    .object({
      runtimeSignatures: z.literal(false),
      reason: z
        .string()
        .optional()
        .describe(
          "Machine-readable reason, e.g. RUNTIME_SIGNATURES_NOT_IN_PLAN"
        ),
      upgradeUrl: z
        .string()
        .optional()
        .describe("Where the organization can upgrade its plan"),
      withheld: z
        .array(z.string())
        .describe("Runtime rules the service declined to run for this plan"),
    })
    .optional()
    .describe("Runtime rules withheld because the plan does not include them"),
  // One entry per rule whose verified outcome needs attention: edited, missing,
  // a runtime rule the service never issued, unaccounted for, or an id shared
  // across engines. Locally written ast-grep and Vale rules are `unknown` too
  // and are deliberately NOT listed: they run, and every run would repeat them.
  integrity: z
    .array(
      z.object({
        ruleId: z.string(),
        engine: z.enum(["sg", "vale", "runtime"]).optional(),
        verdict: z
          .enum(["unsafe", "missing", "unknown", "unaccounted", "duplicate"])
          .describe(
            "unsafe: edited since issued; missing: issued but not on disk; unknown: a runtime rule the service never issued; unaccounted: the service's answer did not account for it; duplicate: its id is used by more than one engine"
          ),
        files: z
          .array(
            z.object({
              path: z.string(),
              expected: z
                .string()
                .optional()
                .describe("Issued signature; absent for an added file"),
              got: z
                .string()
                .optional()
                .describe("Reported signature; absent for a removed file"),
            })
          )
          .optional()
          .describe("For unsafe: each file that differs from what was issued"),
        revisionId: z
          .string()
          .optional()
          .describe("For missing: the revision `rule restore` brings back"),
      })
    )
    .optional()
    .describe(
      "Rules whose verified state needs attention. `taskless rule restore <ruleId>` repairs unsafe and missing ones"
    ),
});

/** Error schema for `taskless check --json` on failure */
export const errorSchema = z.object({
  success: z.literal(false),
  error: z.string().describe("Error message"),
  results: z.array(checkResultSchema).describe("Check results (may be empty)"),
});
