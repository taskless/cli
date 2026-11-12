import { z } from "zod";

import { findingSchema } from "./finding";

/** A file that differs from what was issued, by signature. */
export const differingFileSchema = z.object({
  path: z.string(),
  expected: z
    .string()
    .optional()
    .describe("Issued signature; absent for an added file"),
  got: z
    .string()
    .optional()
    .describe("Reported signature; absent for a removed file"),
});

const integrityEngineSchema = z.enum(["sg", "vale", "runtime"]).optional();

/**
 * One `check --json` `integrity` entry, discriminated on `verdict` so each
 * verdict carries only its own fields (#647). A flat object with every field
 * optional accepted, and documented, a `missing` entry with `copyOf` or an
 * `unsafe` one with `revisionId`; the pairing lived only in descriptions.
 */
export const integrityEntrySchema = z.discriminatedUnion("verdict", [
  z.strictObject({
    ruleId: z.string(),
    engine: integrityEngineSchema,
    verdict: z.literal("unsafe").describe("Edited since Taskless issued it"),
    files: z
      .array(differingFileSchema)
      .describe("Each file that differs from what was issued"),
  }),
  z.strictObject({
    ruleId: z.string(),
    engine: integrityEngineSchema,
    verdict: z
      .literal("missing")
      .describe("Issued for this repository but not on disk"),
    revisionId: z
      .string()
      .optional()
      .describe("The revision `rule restore` brings back"),
  }),
  z.strictObject({
    ruleId: z.string(),
    engine: integrityEngineSchema,
    verdict: z
      .literal("unknown")
      .describe(
        "A runtime rule the service never issued, or a rule of any engine carrying an issued rule's file (see copyOf)"
      ),
    files: z
      .array(differingFileSchema)
      .optional()
      .describe("For a copy: each file that differs from its source revision"),
    copyOf: z
      .object({
        ruleId: z.string().describe("The issued rule it was copied from"),
        revisionId: z
          .string()
          .optional()
          .describe("The source revision it matches best"),
        sourceMissing: z
          .boolean()
          .describe(
            "The source is also missing from disk: the copy is a rename, and restoring the source is the fix"
          ),
      })
      .optional()
      .describe(
        "The rule carries a file Taskless issued to another rule. An ast-grep or Vale copy does not run and fails the check"
      ),
  }),
  z.strictObject({
    ruleId: z.string(),
    engine: integrityEngineSchema,
    verdict: z
      .literal("unaccounted")
      .describe("The service's answer did not account for it"),
  }),
  z.strictObject({
    ruleId: z.string(),
    engine: integrityEngineSchema,
    verdict: z
      .literal("duplicate")
      .describe("Its id is used by more than one engine"),
  }),
]);

/** A `check --json` `integrity` entry, typed from the schema. */
export type IntegrityEntry = z.infer<typeof integrityEntrySchema>;

/**
 * Finding counts by severity. Every severity is present, zero included, so a
 * reader never has to tell an absent key from a zero.
 */
const severityCountsSchema = z.strictObject({
  error: z.number().int(),
  warning: z.number().int(),
  info: z.number().int(),
  hint: z.number().int(),
});

/**
 * One rule's share of the findings.
 *
 * Grouped by `engine` and `ruleId`, the same pair `verify --json` groups
 * `rules[]` by and `integrity` names a rule with, since an id alone can name a
 * rule under two engines.
 */
const ruleSummarySchema = z.strictObject({
  engine: z
    .enum(["sg", "vale", "runtime"])
    .optional()
    .describe(
      "The engine directory the rule lives under. Absent only for a finding whose `source` this CLI does not map to an engine"
    ),
  ruleId: z.string(),
  total: z.number().int().describe("Findings this rule produced"),
  files: z.number().int().describe("Distinct files those findings are in"),
  severities: severityCountsSchema,
});

/**
 * The per-rule measurement of a run (#678).
 *
 * Small whatever the repository's size: one entry per rule that fired, never
 * one per finding. It is what `--summary` keeps when it drops `results`, so an
 * agent can ask "how many violations of each rule" in one call whose output
 * fits in a harness.
 */
export const checkSummarySchema = z.strictObject({
  total: z.number().int().describe("Findings across every rule"),
  files: z.number().int().describe("Distinct files with at least one finding"),
  severities: severityCountsSchema,
  rules: z
    .array(ruleSummarySchema)
    .describe(
      "One entry per rule with at least one finding, most findings first, then by `ruleId`. A rule absent from this list produced no findings, or did not run: read `skipped`, `failures` and `integrity` for the second"
    ),
});

/** The `summary` of a `check --json` run, typed from the schema. */
export type CheckSummary = z.infer<typeof checkSummarySchema>;

/** A runtime rule that was present but not executed (advisory), for `--json`. */
const skippedRuntimeRuleSchema = z.object({
  rule: z.string().describe("Runtime rule name that did not run"),
  reason: z.string().describe("Why the runtime rule was not run"),
});

/** Output schema for `taskless check --json` on success */
export const outputSchema = z.object({
  success: z.boolean(),
  results: z
    .array(findingSchema)
    .optional()
    .describe(
      "Every finding. Present on every run except one asked for with `--summary`, which omits it; an absent `results` therefore never means a clean run, read `summary.total`"
    ),
  summary: checkSummarySchema.describe(
    "Finding counts, overall and per rule. Always present, `--summary` or not"
  ),
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
  // The exception is a copy of an issued rule (`copyOf`), which does not run.
  runDirectory: z
    .string()
    .optional()
    .describe(
      "Present only with --preserve-logs: the kept run directory, relative to the project root. It holds the snapshot that ran, the assembled engine configs, and engine.log, sg.log, vale.log, and runtime.log"
    ),
  integrity: z
    .array(integrityEntrySchema)
    .optional()
    .describe(
      "Rules whose verified state needs attention. `taskless rule restore <ruleId>` repairs unsafe and missing ones"
    ),
});

/** Error schema for `taskless check --json` on failure */
export const errorSchema = z.object({
  success: z.literal(false),
  error: z.string().describe("Error message"),
  results: z.array(findingSchema).describe("Check results (may be empty)"),
});
