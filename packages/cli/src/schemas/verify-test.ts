import { z } from "zod";

/**
 * One rule's verdict, as `verify` and `test` both report it.
 *
 * The two commands share an implementation and differ only in what they run,
 * so they share one envelope. `ran` is `test`-only: `verify` never reaches a
 * test run, and `test` reports `false` when verification failed first.
 */
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
  notice: z
    .string()
    .optional()
    .describe(
      "Something true about the rule that does not make it a failure, reported even on a pass"
    ),
});

/** Output schema for `taskless verify --json` and `taskless test --json`. */
export const outputSchema = z.object({
  ok: z.boolean(),
  rules: z.array(ruleResultSchema).describe("Per-rule results"),
});
