---
"@taskless/cli": patch
---

Validate an sg rule's `language:` field in `verify`, instead of leaving it to
ast-grep at `check` time.

Nothing local had an opinion on the field. The vendored rule schema types it as
a bare string with no enum, so `verify` returned `ok: true` for any spelling and
the binary was the first thing to object — in the two ways it objects, both of
them late:

- A name ast-grep does not recognize fails `SgLang` deserialization, which
  aborts parsing of the single config Taskless assembles per run. One typo takes
  every _other_ sg rule down with it. `verify` now fails that rule by name,
  prints the accepted spellings, and suggests the obvious canonical one where
  there is one (`C#` → `CSharp`).
- A recognized name pointing at the wrong parser reports nothing and reads as a
  clean codebase. `Tsx` and `TypeScript` are two parsers, not aliases, so a
  `TypeScript` rule scoped to `**/*.tsx` matches nothing and exits zero.
  `verify` fails that rule, and notices the half-dead case where a `{ts,tsx}`
  glob reaches both.

Case variants and ast-grep's extension aliases are accepted rather than
rejected, since ast-grep accepts them itself: `typescript`, `TYPESCRIPT` and
`ts` all reach TypeScript. They get a notice naming the canonical spelling, so
rules already written the lowercase way — including the ones in this
repository — keep passing.

The `files:` scan reads both shapes ast-grep allows for a glob entry, the plain
string and the `{ glob, caseInsensitive }` object, so the wrong-parser check is
not silently skipped for rules written the second way.
