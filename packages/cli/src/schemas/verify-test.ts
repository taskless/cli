import { z } from "zod";

/**
 * One rule's verdict, as `verify` and `test` both report it.
 *
 * The two commands share an implementation and differ only in what they run,
 * so they share one envelope. `ran` is `test`-only: `verify` never reaches a
 * test run, and `test` reports `false` when verification failed first.
 */
/**
 * A position, zero-based in both axes, exactly as `check --json` reports one.
 */
const positionSchema = z.object({
  line: z.number().int(),
  column: z.number().int(),
});

/**
 * One finding a rule's fixtures produced.
 *
 * The `CheckResult` shape `check --json` already prints, plus the `bucket` the
 * fixture that produced it lives in. Reused verbatim rather than narrowed to
 * what `test` "needs": a finding means the same thing whichever command
 * surfaced it, and a second, smaller shape would be a second thing to keep in
 * step with the engines.
 *
 * `message` is the field this exists for. It is the RENDERED message, with the
 * rule's captures already interpolated, and it is the only evidence that a
 * rule whose message interpolates its captures put the slots in the right
 * order — such a rule fires on every `fail/` fixture, stays quiet on every
 * `pass/` one, and a boolean verdict reports it as a rule that passed.
 */
const fixtureFindingSchema = z.object({
  source: z.string().describe("The engine that produced it"),
  ruleId: z.string(),
  severity: z.enum(["error", "warning", "info", "hint"]),
  message: z
    .string()
    .describe(
      "The message as the engine rendered it, with the rule's captures already interpolated"
    ),
  note: z.string().optional(),
  file: z.string().describe("The fixture the finding was reported against"),
  range: z.object({ start: positionSchema, end: positionSchema }),
  matchedText: z.string(),
  fix: z.string().optional(),
  bucket: z
    .enum(["pass", "fail"])
    .describe(
      "The fixture bucket that produced it. A `pass` finding is a rule that fired where it should not have; a `fail` finding is the rule doing its job"
    ),
});

const ruleResultSchema = z.object({
  engine: z.enum(["sg", "vale", "runtime"]),
  ruleId: z.string(),
  ok: z.boolean(),
  errors: z.array(z.string()).describe("Human-readable failure messages"),
  violations: z
    .array(
      z.object({
        constraintId: z
          .string()
          .describe(
            "Stable id of a constraint published in `@taskless/cli/reference.json`"
          ),
        message: z
          .string()
          .describe(
            "The failure message reporting it, repeated verbatim from `errors`"
          ),
      })
    )
    .describe(
      "The subset of `errors` a published constraint accounts for. `errors` stays complete, so this is additive: read it to map a rejection to the rationale the corpus publishes, instead of matching on message text, which changes without notice. Empty when nothing failed and when what failed is not something a published constraint describes"
    ),
  ran: z
    .boolean()
    .optional()
    .describe(
      "`test` only: whether the rule's tests actually ran. Branch on this, not on `ok` alone: `ok: true` with `ran: false` is not a rule that passed"
    ),
  refused: z
    .string()
    .optional()
    .describe(
      "`test` only: the execution policy declined to run the rule's fixtures, and why. Neither a pass nor a failure, excluded from the rules tested, and never on its own a reason for a non-zero exit"
    ),
  notices: z
    .array(z.string())
    .describe(
      "Things true about the rule that do not make it a failure, reported even on a pass. One notice per element, so a consumer can render each on its own; empty when there is nothing to say, never absent"
    ),
  findings: z
    .array(fixtureFindingSchema)
    .default([])
    .describe(
      "The findings this rule's fixtures produced, each tagged with its bucket. ALWAYS PRESENT, empty rather than absent — for a rule that produced nothing, for one whose verification failed before its fixtures ran, for a refused run, for `verify`, which runs no fixtures at all, and for an engine whose fixture findings are not surfaced yet. A key that is sometimes absent is one a reader learns to treat as optional, and reads absence as zero. The `fail` bucket is reported on a passing run too: it is the evidence that the rendered messages say what their author meant, and a payload carrying that only once the rule is already failing carries it at the one moment it is no longer needed"
    ),
});

/** Output schema for `taskless verify --json` and `taskless test --json`. */
export const outputSchema = z.object({
  ok: z.boolean(),
  rules: z.array(ruleResultSchema).describe("Per-rule results"),
});
