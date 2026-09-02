/**
 * Escape the characters that carry meaning in a regular expression, so a
 * string can be embedded in a pattern as a literal.
 *
 * Shared because two callers needed exactly this and each wrote its own:
 * `rules/verify.ts` anchors a rule id for ast-grep's `--filter`, and
 * `test/recipe-cross-references.test.ts` builds an alternation of subcommand
 * and CLI names. Both were the same function with the character class written
 * in a different order.
 */
export function escapeRegExp(literal: string): string {
  return literal.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}
