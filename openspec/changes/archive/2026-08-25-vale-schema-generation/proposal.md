## Why

`vale-authoring-polish` landed a Vale rule schema and called it, in its own module comment, **a transcription**: twelve check types, three levels, ten field tables and twenty-eight scope operands read off a binary by hand.

Every one of those was measured — by a script that was then thrown away. What survives is the answer, not the question. The next person to raise `VALE_VERSION` gets a test failure naming a field and no way to reproduce the measurement it is failing against.

The measuring is also where the errors live, and one is on the record. A probe grepping stdout for `has invalid keys` reads a Go panic as a clean run — a panic contains no such string — which is how a tokenless `sequence` rule came to look like a check that validates nothing:

```
sequence, bare rule, probe grepping for "has invalid keys"  ->  read as "accepts any key"
sequence, bare rule, actual behavior                        ->  panic: interface conversion
```

A method that can make that mistake is worth writing down once, correctly.

## What Changes

- **A generator derives the vocabulary from the vendored binary.** `pnpm generate:vale-schema` writes `packages/cli/src/generated/vale-vocabulary.ts`, a checked-in artifact pinned to `VALE_VERSION`, mirroring how `fetch-ast-grep-schema.ts` produces `ast-grep-rule-schema.json`. `vale-rule.ts` imports it and keeps zod as the validation layer.
- **Verdicts come from the exit status and the structured JSON, never from a phrase match.** Vale's `--output=JSON` emits `{Line, Path, Text, Code, Span}` on stderr for a config error. The generator keys on `Code`, parses `Text` structurally, detects panics explicitly, and treats any outcome it does not recognize as fatal.
- **The generator fails loudly rather than emitting a short enum.** If the `'extends' key must be one of [...]` line stops matching, it errors. A truncated enum is _stricter_ than the binary, which is the direction that blocks working rules.
- **A divergence report ships with the artifact.** Where the binary and Vale's documentation disagree, the disagreement is written to `vale-vocabulary-report.md` rather than silently dropped on one side or the other.
- **The three fatal-shape checks stay hand-written.** A `sequence` with no `tokens`, a `sequence` whose `tokens` is not a list, and a `metric` with a `formula` and no `condition` each panic the binary. That is behavior a field table cannot express, so it stays a `.check()` beside the union.
- **No behavior change.** All 86 existing corpus rows pass unmodified against the generated schema; two rows are added for ground the generation newly measured.

## Capabilities

### New Capabilities

None. This changes how an existing capability's data is produced.

### Modified Capabilities

- `cli-rule-validation`: the requirement "The Vale rule schema is pinned to the vendored binary" says the schema "SHALL be authored in this repository" and calls it a transcription. It becomes a derivation: the vocabulary SHALL be generated from the vendored binary by a script in the repository, and the requirement gains the two constraints that make a derivation trustworthy — fail loudly on an unrecognized error shape, and report rather than drop a divergence.

## Impact

- `packages/cli/scripts/generate-vale-schema.ts` — new.
- `packages/cli/src/generated/vale-vocabulary.ts` and `vale-vocabulary-report.md` — new, checked in.
- `packages/cli/src/schemas/vale-rule.ts` — the enums and field tables are replaced by imports; the zod construction, the scope grammar, and the fatal-shape checks are unchanged.
- `packages/cli/package.json` — one script.
- `packages/cli/test/vale-corpus.ts` — two rows added, none modified.
- Refs #171.

## Delivery shape

**Single PR.** The generator, the artifact it produces, and the schema's switch to importing it are one reviewable diff and are only correct together: the artifact is meaningless without the generator that reproduces it, and `vale-rule.ts` does not compile without the artifact. There is no intermediate state that reaches production safely, and no unit that a reviewer would be better off seeing alone.

It stacks on `openspec/vale-authoring-polish-schema` (#175), whose schema it rewrites, so it is the tip of that stack and archives the change.
