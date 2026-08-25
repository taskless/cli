---
"@taskless/cli": patch
---

Derive the Vale rule schema's vocabulary from the vendored binary instead of
transcribing it by hand.

`pnpm generate:vale-schema` runs the pinned Vale against rules it writes itself
and emits `src/generated/vale-vocabulary.ts` — twelve check types, three levels,
ten per-check field tables, twenty-eight scope operands, two open scope
families — plus a divergence report. `src/schemas/vale-rule.ts` imports it and
stays what it was: the zod layer, the scope grammar, and the error messages that
explain blast radius to an author. Every corpus row that predates the generation
passes against the generated schema unmodified, and rows were added to cover
ground the generation newly measured.

One of those measurements found a real gap. Vale decodes a check's own fields
case-insensitively, so `Tokens:` means `tokens:`, but a few keys are read off
the raw mapping before that decode and are not synonyms of their capitalised
spellings. Assuming that set was the three header keys was wrong: `scope` and
`name` are read literally too, so `Scope: raw` fails the run with
`E201 has invalid keys: 'scope'` while the schema, having lowercased it, was
accepting it. For `scope` that was the worse half of the bug, because
canonicalising the key also routed the value past the scope grammar, which is
the only thing that ever inspects it. The set is now derived as a per-key
two-run differential (the lowercase spelling must run clean; the capitalised one
either runs clean too or draws a diagnostic) and emitted as
`VALE_LITERAL_KEYS`, with corpus rows for `Scope:`, `Name:` and, as the contrast
that keeps them from proving too much, `Tokens:`.

What a transcription lost was not the answer but the question. Every value in the
previous schema _was_ measured — by a script that was then discarded, leaving the
next person to raise `VALE_VERSION` with a failing test and no way to reproduce
the measurement it was failing against.

The measuring is also where the errors live, so the generator is built around one
rule: **every verdict comes from the process exit status and the structured JSON
output, never from matching stdout against an error phrase.** A Go panic contains
no `has invalid keys` string, so a phrase-grep scores a crash as a clean run —
which is exactly how a tokenless `sequence` rule once came to look like a check
that validates nothing. A run's outcome is a closed set of `clean`, `diagnostic`,
`panic`, and `unrecognized`, and the last one is fatal at every call site.

Two of the four vocabularies are self-enumerating: an unknown `extends` or
`level` makes the binary name its own accepted set. If either of those lines
stops matching, generation **fails** rather than emitting a short enum — a
truncated enum is _stricter_ than the binary, which is the direction that blocks
rules that would have worked.

The other two are honest about their limit, and the artifact says so. `E201`
names the key you got wrong and never the ones you could have used, and an
unrecognized `scope` raises nothing at all — so field tables and scope operands
are **verified, not discovered**, from a candidate list seeded from four sources
with its provenance recorded. A scope verdict is three-valued, and a `scope: raw`
reach probe must fire on every fixture, so an operand cannot be dropped because
its fixture was never linted.

Where the binary and Vale's documentation disagree, `vale-vocabulary-report.md`
records it rather than either side being quietly dropped: `meta` and
`meta.class.<kind>` are documented and never fire; `frontmatter` and
`frontmatter.<key>` fire and are documented nowhere; `consistency` and `spelling`
validate no keys at all.
