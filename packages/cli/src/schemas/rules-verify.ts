import { z } from "zod";

// --- Schema mode output (--schema --json) ---

export const schemaOutputSchema = z.object({
  astGrepSchema: z
    .record(z.string(), z.unknown())
    .describe("Official ast-grep rule JSON Schema"),
  tasklessRequirements: z
    .object({
      requiredFields: z
        .array(z.string())
        .describe("Fields Taskless requires beyond ast-grep defaults"),
      rules: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
        })
      ),
    })
    .describe("Taskless-specific validation rules"),
  examples: z
    .array(
      z.object({
        description: z.string(),
        rule: z.record(z.string(), z.unknown()),
      })
    )
    .describe("Curated annotated rule examples"),
});

// --- Verify mode output (rule verify <id> --json) ---

const layerResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()).describe("Human-readable error messages"),
});

const testLayerResultSchema = layerResultSchema.extend({
  passed: z.number().describe("Number of test cases that passed"),
  failed: z.number().describe("Number of test cases that failed"),
});

export const verifyOutputSchema = z.object({
  engine: z
    .literal("sg")
    .describe("The engine that owns this rule, decided by where its file lives"),
  success: z.boolean().describe("True if all layers passed"),
  ruleId: z.string(),
  schema: layerResultSchema.describe("Layer 1: Zod schema validation"),
  requirements: layerResultSchema.describe(
    "Layer 2: Taskless requirement checks"
  ),
  tests: testLayerResultSchema.describe("Layer 3: sg test execution"),
});

/**
 * Vale verification output.
 *
 * Deliberately not squeezed into the ast-grep shape. `sg` verification is three
 * layers over a rule file and its test cases; Vale verification is one question
 * asked of two fixture buckets — did every `fail/` document fire, did every
 * `pass/` document stay quiet. Mapping the second onto `schema`/`requirements`/
 * `tests` would invent two empty layers and lose the fixture coverage, which is
 * the part that catches a rule that was never really verified.
 *
 * `engine` is the discriminant. A consumer branches on it before reading
 * anything else, and adding an engine cannot silently change the meaning of a
 * field another engine already emits.
 */
export const valeVerifyOutputSchema = z.object({
  engine: z.literal("vale"),
  success: z
    .boolean()
    .describe("True only when both buckets are populated and both behaved"),
  ruleId: z.string(),
  fixtures: z
    .enum(["both", "pass-only", "fail-only", "none"])
    .describe(
      "Which fixture buckets held documents. Only 'both' can succeed: one bucket alone is half a claim"
    ),
  missingFailures: z
    .array(z.string())
    .describe("fail/ fixtures the rule should have flagged and did not"),
  unexpectedFindings: z
    .array(z.string())
    .describe("pass/ fixtures the rule flagged and should not have"),
});

export const verifyErrorSchema = z.object({
  success: z.literal(false),
  error: z.string().describe("Error message"),
});
