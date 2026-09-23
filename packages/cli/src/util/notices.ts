/**
 * Building the `notices` a run carries — advisory text a command should say
 * without failing over it.
 *
 * A leaf module with no imports of its own, deliberately. The producers live in
 * `rules/dispatch.ts`, `rules/inspect.ts`, `rules/verify.ts` and
 * `rules/vale/run.ts`; having any of them import this from a sibling would add
 * an edge inside `src/rules/` between modules that already sit close to a cycle
 * (see the `filesystem/migrate.ts` cycle fixed in taskless/cli#388, which cost
 * real time and was found by luck). `import-x/no-cycle` runs over every
 * TypeScript file and would catch it eventually; not creating the edge is
 * cheaper than relying on that.
 */

/**
 * Gather advisories into the flat, ordered list a `notices` field carries.
 *
 * **One element per notice.** This is the contract the renderers depend on:
 * `commands/check.ts` prints `Notice: ` and `commands/verify.ts` prints
 * `    notice: ` once per notice, so two advisories glued into one element read
 * as one notice with a stray tail. That is the defect `241e1c4` fixed in
 * `verify`, and it is why producers hand back elements rather than a
 * pre-joined string: presentation belongs to the renderer, and a producer that
 * picked its own separator would mis-render in the direction hardest to notice
 * — the notice still appears, just wrongly attributed.
 *
 * A single element may still contain `"\n"`, because one notice can be
 * multi-line prose: Vale's stderr on a zero-exit run is passed through as
 * written and can span lines. That is formatting *within* one message, not a
 * separator *between* messages, and the renderers prefix every line of it.
 *
 * `undefined` entries are dropped, because callers assemble notices from
 * optional sources — a Vale advisory that may not exist beside a schema one
 * that may not either — and the alternative is a filter at every call site.
 *
 * **Empty strings are dropped too.** A `""` would otherwise render as a bare
 * `Notice: ` marker saying nothing. Four producers independently emitting that
 * was never a contract anyone designed; it was what
 * `filter((x) => x !== undefined)` happened to do.
 *
 * @param notices Advisories in the order they should be read. Order is
 * preserved: callers put the more specific advisory first.
 * @returns Every present, non-empty notice, in order. Empty when none survive,
 * which is what lets a call site spread
 * `...(notices.length === 0 ? {} : { notices })` and leave the field off.
 */
export function collectNotices(
  notices: ReadonlyArray<string | undefined>
): string[] {
  return notices.filter(
    (notice): notice is string => notice !== undefined && notice !== ""
  );
}
