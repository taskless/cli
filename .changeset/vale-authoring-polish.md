---
"@taskless/cli": patch
---

Close the gaps in `create-vale-rule` that produce a rule which is green
everywhere and reports nothing.

A malformed Vale rule fails loudly. A Vale rule that is merely _wrong_ passes
`verify`, passes `test`, and never fires — and nobody re-checks a green rule.
The recipe now documents each of those failures as an observed behavior of the
pinned Vale binary rather than as a caution in principle:

- **The measured `scope` vocabulary**, with what each value actually reaches.
  `raw` subsumes `code` and `text`; `~` negation and `&` chaining are accepted;
  and a negation over a scope Vale does not know (`~fenced`) is a silent no-op
  that removes the exclusion you wrote the rule for.
- **`scope` is per-rule.** Taskless assembles one config per run, which invites
  the assumption that scopes interact. They do not.
- **A `raw`-scoped rule cannot be suppressed** by `<!-- vale Rule = NO -->`,
  because it reads the unparsed document — so a rule about a shell command needs
  `raw` and trades away per-case exemption.
- **A punctuation-only token needs `nonword: true`**, because Vale wraps every
  token in word boundaries and an em dash has no word character on either side.
- **How to scope a rule _out_**, with a second matcher assigning `NO`.
- **Collocation guidance** for a banned word, checked by writing the `pass/`
  fixture from the literal sense first.
- **Fixture design for a subject that appears in code**: `fail/` must carry it
  inline, fenced, and in prose.
- **`limit` and `vocab`** in the common-fields table, and that Vale loads only
  `.yml` — a style file renamed to `.yaml` is silently not loaded at all.
- **Fixtures run under an isolating config**, so a green `test` is not evidence
  the rule's matcher glob reaches any real file.

Vale's check types are now enumerated from the binary rather than the docs.
There are **twelve**, not eleven: the docs fold `readability` into `metric`.
The per-check field tables are measured the same way, which corrects two
published claims — `capitalization` rejects `prefixes`/`suffixes`, and
`occurrence` rejects `exceptions`.
