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
- **`limit`** in the common-fields table, **`vocab`** with the per-check fields
  it actually belongs to, and that Vale loads only `.yml` — a style file renamed
  to `.yaml` is silently not loaded at all.
- **Fixtures run under an isolating config**, so a green `test` is not evidence
  the rule's matcher glob reaches any real file.

Vale's check types are now enumerated from the binary rather than the docs.
There are **twelve**, not eleven: the docs fold `readability` into `metric`.
The per-check field tables are measured the same way, which corrects three
published claims: `capitalization` takes `prefix` (singular) and rejects
`prefixes` and `suffixes`, `capitalization` rejects `ignorecase`, and
`occurrence` rejects `exceptions` and `vocab`.

`verify` now schema-checks a Vale rule structurally, before Vale is invoked.
It previously validated `level` and the presence of the rule's `.vale.ini`, so
`extends: nonsense` and `scope: fenced` both verified clean. It now also checks:

- **`extends`** against the twelve check types, naming the accepted set.
- **`scope`** as a grammar over measured operands — a bare value, a list, `~`
  negation, `&` chaining — rather than a flat enum, which would have rejected
  working rules. It is deliberately stricter than Vale in one place: a negation
  over an operand Vale does not know (`~fenced`) fires on everything, having
  silently lost its exclusion, and is rejected.
- **Per-check fields**, so a field belonging to another check type is caught
  before Vale reports `E201`. `consistency` and `spelling` are exempt because
  the binary accepts any key on those two.

The ordering is the point for two of the three: Vale reads one assembled config
per run, so an unknown `extends` or a foreign field reaching the binary takes
down **every** Vale rule's findings, not just the offending rule's.

The schema is hand-authored, because Vale publishes no JSON Schema and its
machine-readable field knowledge is behind a paid hosted MCP. What holds it to
the binary is a corpus of 82 minimal rules, each with a document it must flag,
run through both the vendored Vale and the schema, asserting the two agree —
with guards so that a rule which "did not fire" because its fixture was
unreachable cannot pass as a measurement. A Vale upgrade that changes the
vocabulary fails a test that names the value.
