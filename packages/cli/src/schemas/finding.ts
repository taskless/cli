import { z } from "zod";

/**
 * A position, zero-based in both axes.
 */
const positionSchema = z.object({
  line: z.number().int(),
  column: z.number().int(),
});

/**
 * One finding: a place a rule fired.
 *
 * The ONE finding shape, for every command that reports findings. `check
 * --json` prints these as `results[]`, and `verify --json` prints them under
 * `rules[].findings[]`, extended with the fixture `bucket` that produced them.
 * A finding from either command parses against this schema, so a script
 * written for one reads the other (#678).
 *
 * The two used to be declared separately and had drifted: `check` allowed a
 * `null` `note` and `fix`, `verify` did not. Nothing about a finding depends on
 * which command surfaced it, so there is one declaration and the looser of the
 * two spellings, since `check` has always emitted it.
 *
 * `message` is the RENDERED message, with the rule's captures already
 * interpolated. For `verify` that is the only evidence that a rule whose
 * message interpolates its captures put the slots in the right order.
 */
export const findingSchema = z.object({
  source: z
    .string()
    .describe(
      "The engine that produced it: `ast-grep`, `vale` or `taskless-runtime`"
    ),
  ruleId: z.string().describe("Rule identifier"),
  severity: z
    .enum(["error", "warning", "info", "hint"])
    .describe("Severity level"),
  message: z
    .string()
    .describe(
      "The message as the engine rendered it, with the rule's captures already interpolated"
    ),
  note: z.string().nullable().optional().describe("Additional notes"),
  file: z
    .string()
    .describe("Project-relative path of the file the rule fired in"),
  range: z.object({ start: positionSchema, end: positionSchema }),
  matchedText: z.string().describe("The code that matched the rule"),
  fix: z.string().nullable().optional().describe("Suggested fix replacement"),
});
