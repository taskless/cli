import type { z } from "zod";

/**
 * The verdict of a schema layer, in the shape `verify` reports.
 *
 * Structurally identical to `LayerResult` in `rules/verify.ts`, and deliberately
 * declared here rather than imported from there: `rules/verify.ts` already
 * imports from this directory, so pointing the dependency the other way would
 * close a cycle.
 */
export interface SchemaLayerResult {
  valid: boolean;
  errors: string[];
}

/**
 * How one issue becomes one line of `verify` output.
 *
 * The two engines want different things here, which is the whole reason this is
 * a parameter. ast-grep validates against an upstream JSON Schema whose messages
 * are generic ("Invalid input: expected string"), so the *path* is what makes
 * them actionable. The Vale schema is hand-authored and every message is already
 * a full sentence naming its own field, so a path prefix would only repeat it.
 */
export type IssueFormatter = (issue: z.core.$ZodIssue) => string;

/**
 * A zod parse result, as one layer of `verify`.
 *
 * Both engines' schema layers report through this, so a rule that fails
 * validation fails the same way whichever engine wrote it — which is the
 * property the spec asks for and the one that was lost while the Vale path was
 * a hand-rolled walker returning strings and the ast-grep path returned
 * `ZodIssue`s.
 */
export function schemaLayer(
  result: z.ZodSafeParseResult<unknown>,
  format: IssueFormatter
): SchemaLayerResult {
  if (result.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: result.error.issues.map((issue) => format(issue)),
  };
}

/** ast-grep's formatter: the path is what makes an upstream message useful. */
export const pathPrefixed: IssueFormatter = (issue) =>
  `${issue.path.join(".")}: ${issue.message}`;
