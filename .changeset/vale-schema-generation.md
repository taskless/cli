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
explain blast radius to an author. Nothing about `verify`'s behavior changes; all
86 existing corpus rows pass against the generated schema unmodified, and two
were added for ground the generation newly measured.

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
