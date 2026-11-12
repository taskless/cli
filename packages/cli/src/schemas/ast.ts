import { z } from "zod";

import { AST_GREP_LANGUAGES } from "../rules/capabilities";

const positionSchema = z.object({
  line: z.number().int().positive().describe("1-based line"),
  column: z.number().int().nonnegative().describe("0-based UTF-8 byte column"),
});

interface AstNodeOutput {
  kind: string;
  field?: string;
  start: z.infer<typeof positionSchema>;
  end: z.infer<typeof positionSchema>;
  text?: string;
  children: AstNodeOutput[];
}

/** One named node. Every `kind` here is one a rule's `kind:` accepts. */
const astNodeSchema: z.ZodType<AstNodeOutput> = z.object({
  kind: z.string().describe("The node kind, usable as `kind:` in a rule"),
  field: z
    .string()
    .optional()
    .describe("The field this node fills in its parent, when named"),
  start: positionSchema,
  end: positionSchema.describe("Exclusive end"),
  text: z
    .string()
    .optional()
    .describe("Source text, present on nodes with no named children"),
  get children() {
    return z.array(astNodeSchema);
  },
});

/** `taskless ast --json` */
export const outputSchema = z.object({
  ok: z.literal(true),
  file: z.string().describe("The file, as given"),
  language: z
    .enum(AST_GREP_LANGUAGES)
    .describe("The ast-grep language the file was parsed as"),
  range: z
    .object({ from: z.number().int(), to: z.number().int() })
    .optional()
    .describe("The --range the tree was cut to, 1-based and inclusive"),
  errorNodes: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "ERROR nodes in the tree; above zero, the file did not parse cleanly as this language"
    ),
  root: astNodeSchema,
});
