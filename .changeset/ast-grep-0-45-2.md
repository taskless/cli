---
"@taskless/cli": patch
---

Upgrade the vendored ast-grep from 0.41.0 to 0.45.2, and add `Markdown` and
`Dart` to the languages `sg` rules can target.

**One breaking change reaches user rules.** A `rewriters:` entry now requires a
`fix:`. It was optional in 0.41.0, and the regenerated rule schema makes
`verify` name the offending rewriter directly. It cannot be migrated for you:
`fix` is replacement text, so a tool can find every affected rewriter but
cannot write one. Nothing shipped here uses `rewriters:`, so this only affects
rules you wrote yourself. Elsewhere the schema barely moves: `matches:` widens
from a plain utility-rule id to also accept a parameterized call object, which
is backward compatible, and the top-level property set is unchanged.

**`Markdown` is narrower than the name suggests, and the routing recipes now
say so.** tree-sitter-markdown splits its grammar into block and inline halves
and ast-grep exposes only the block tree. `atx_heading`, `setext_heading`,
`fenced_code_block`, `list_item`, `paragraph`, `section` and `document` are
real kinds, and headings discriminate by level. Everything inside a line is one
opaque `inline` node: there is no `link`, `emphasis` or `strong_emphasis`.
Naming one is a config error that exits 8 and takes the whole scan with it;
writing it as a pattern instead matches nothing forever with no error at all.
So "link text must not read click here" is a Vale rule, not an `sg` rule, and
"every doc has exactly one h1" is neither, because ast-grep has no count and no
absence assertion. `.md` is the first extension both static engines claim, so
`route` now says which question each answers rather than leaving it to the file
extension.

Also: the `sg` alias is deprecated as of ast-grep 0.45.0 and prints a banner to
stderr on every run. On a host where only `sg` resolves, that banner used to be
decoded into user-facing messages as if an engine had reported it. It is now
stripped.
