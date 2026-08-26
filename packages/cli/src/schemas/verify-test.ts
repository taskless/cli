import { z } from "zod";

import { migratedSchema } from "./migration";

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
  ran: z
    .boolean()
    .optional()
    .describe("`test` only: whether the rule's tests actually ran"),
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
  // Both commands migrate `.taskless/` before resolving a path, which rewrites
  // files in the working tree. Absent unless it happened.
  migrated: migratedSchema
    .optional()
    .describe("Present only when this run migrated the .taskless/ layout"),
});
