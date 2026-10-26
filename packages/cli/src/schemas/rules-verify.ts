import { z } from "zod";

import { fixtureFindingSchema } from "./rule-check";

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

// --- Verify layer detail ---
//
// The shape `verifyRule()` (ast-grep) and `verifyValeRule()` (Vale) return
// internally: schema/requirements/tests kept as separate layers rather than
// flattened. `validate`/`verify`'s own implementation is the only caller of
// either function, and it flattens this into the single `errors`/
// `violations` envelope `ruleCheckOutputSchema` describes before printing
// anything — so this layered shape is not what `taskless validate --json` or
// `taskless verify --json` put on stdout today. It once was: `taskless rule
// verify <id> --json` printed exactly this (`engine: "sg"` plus `verifyRule`'s
// result), until rule addressing moved from id to path — an id can name a
// rule under two engines, a path cannot — and `rule verify` was removed with
// it. See `resolve-path.ts` for why that move happened.

const layerResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()).describe("Human-readable error messages"),
});

/**
 * Layer 1, which alone can also report things that are true but not failures.
 *
 * An sg rule spelled `language: typescript` reaches the right parser and
 * validates clean, but `TypeScript` is how ast-grep spells it. That is worth
 * saying on a rule that passed, so it cannot ride in `errors`.
 *
 * A list, one notice per element, because a rule can be true of more than one
 * of these at once — an off-list spelling and a `files:` glob its language
 * cannot parse. It was a single string joined with a space, which a consumer
 * could not split back apart and which rendered as one run-on line.
 */
const schemaLayerResultSchema = layerResultSchema.extend({
  notices: z
    .array(z.string())
    .describe(
      "Things true about the rule that do not make it invalid — an accepted-but-off-list `language:` spelling above all. One notice per element; empty when there is nothing to say, never absent"
    ),
});

/**
 * Which buckets held cases, the same four states for every engine. Only `both`
 * can succeed: a `fail/` case shows the rule fires, a `pass/` case that it stays
 * quiet, and either alone is half a claim.
 */
const fixtureCoverageSchema = z
  .enum(["both", "pass-only", "fail-only", "none"])
  .describe(
    "Which fixture buckets held cases. Only 'both' can succeed: one bucket alone is half a claim"
  );

/**
 * Every finding the cases produced, in the shape `check --json` prints plus the
 * bucket. Declared here, not only in the CLI's types, because `parse()` strips
 * what a schema does not declare: an envelope without it would hand a consumer
 * the verdict and silently drop the rendered messages that justify it.
 */
const fixtureFindingsSchema = z
  .array(fixtureFindingSchema)
  .describe(
    "Every finding the fixture cases produced, each tagged with its bucket, the fail/ ones included on a passing rule. Empty, never absent, when there were none"
  );

const testLayerResultSchema = layerResultSchema.extend({
  passed: z.number().describe("Number of fixture cases that passed"),
  failed: z.number().describe("Number of fixture cases that failed"),
  fixtures: fixtureCoverageSchema,
  findings: fixtureFindingsSchema,
});

export const verifyOutputSchema = z.object({
  engine: z
    .literal("sg")
    .describe(
      "The engine that owns this rule, decided by where its file lives"
    ),
  success: z.boolean().describe("True if all layers passed"),
  ruleId: z.string(),
  schema: schemaLayerResultSchema.describe(
    "Layer 1: Zod schema validation, plus the `language:` check the vendored JSON Schema cannot express"
  ),
  requirements: layerResultSchema.describe(
    "Layer 2: Taskless requirement checks"
  ),
  tests: testLayerResultSchema.describe(
    "Layer 3: every fixture case, scanned with the case directory as its root"
  ),
});

/**
 * Vale verification output.
 *
 * Deliberately not squeezed into the ast-grep shape. `sg` verification is three
 * layers over a rule file and its fixture cases; Vale verification is one
 * question asked of two fixture buckets — did every `fail/` case fire, did
 * every `pass/` case stay quiet. Mapping the second onto `schema`/`requirements`/
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
  fixtures: fixtureCoverageSchema,
  findings: fixtureFindingsSchema,
  missingFailures: z
    .array(z.string())
    .describe(
      "fail/ case directories the rule should have flagged and did not, project-relative"
    ),
  unexpectedFindings: z
    .array(z.string())
    .describe(
      "pass/ case directories the rule flagged and should not have, project-relative"
    ),
  errors: z
    .array(z.string())
    .describe(
      "One line per case that did not come out as its bucket asserts, or why the cases could not be read; a quiet fail/ case says whether the rule's scope excluded it. Empty when everything passed"
    ),
  notices: z
    .array(z.string())
    .describe(
      "What Vale wrote to stderr while still exiting zero — a W101 ignored-assignment warning above all — plus the converter-skip notice, one per element. Empty when Vale said nothing, never absent"
    ),
});

export const verifyErrorSchema = z.object({
  success: z.literal(false),
  error: z.string().describe("Error message"),
});
