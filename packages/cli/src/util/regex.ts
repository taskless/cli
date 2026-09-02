/**
 * Escape the characters that carry meaning in a regular expression, so a
 * string can be embedded in a pattern as a literal.
 *
 * Shared because five callers needed exactly this and each wrote its own:
 * `rules/verify.ts` anchors a rule id for ast-grep's `--filter`,
 * `test/recipe-cross-references.test.ts` builds an alternation of subcommand
 * and CLI names, `test/api-deprecated-paths.test.ts` anchors a deprecated path
 * prefix, `filesystem/migrations/0005-rule-directories.ts` anchors a rule id in
 * a Vale assignment, and `test/ast-grep-vendor-contract.test.ts` anchors a
 * fixture line.
 *
 * **The count was originally wrong, and how it was counted is why.** The first
 * pass searched for the identifier `escapeRegExp` and found two. Three more
 * copies inlined the expression without ever naming it, so they were invisible
 * to that search — including one in a file the same change was already editing.
 * Grep for the character class, not for the name.
 *
 * The five were not written identically: three spelled the class
 * `[$()*+.?[\\\]^{|}]` and one spelled it `[.*+?^${}()|[\]\\]`. Those are the
 * same fourteen characters in a different order, checked exhaustively over
 * every Unicode code point rather than by eye, which is the only reason
 * consolidating them was safe. `0005` is a shipped migration that has already
 * run on real projects, so its escaping had to be provably identical, not
 * merely similar.
 */
export function escapeRegExp(literal: string): string {
  return literal.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}
