# Vale 3.18.0 vocabulary: divergence report

GENERATED FILE — DO NOT EDIT. Produced by `pnpm generate:vale-schema`
alongside `vale-vocabulary.ts`.

Every value in the vocabulary is the recorded answer of the vendored Vale
3.18.0 binary. This file is what the binary said that its own
documentation does not, in both directions. A generator that dropped these
would be quietly deciding which of the two to believe.

## What was derived, and what was seeded

| Vocabulary       | Oracle                               | Discovers?               |
| ---------------- | ------------------------------------ | ------------------------ |
| Check types (12) | `'extends' key must be one of [...]` | yes                      |
| Levels (3)       | `'level' must be one of [...]`       | yes                      |
| Per-check fields | `has invalid keys: '<name>'`         | **no — membership only** |
| Scope operands   | none; an unknown scope is silent     | **no — fixture probe**   |

The bottom two rows are verified, not discovered. `E201` names the key you got
wrong and never the ones you could have used, and an unknown scope produces no
error at all. A real field or operand that the generator's candidate list does
not propose is simply absent from the vocabulary, and the schema then rejects a
rule the binary accepts — the too-strict direction, which the design ranks as
the worse failure.

## Divergences

### `scope: meta`

Vale 3.18.0 documents this operand and it never fired, on any fixture probed (.md).

**Consequence.** It is omitted from the vocabulary, so `verify` rejects it. A rule written from the documentation would otherwise load, run, and match nothing, with no error reported anywhere.

### `scope: meta.class.title`

Vale 3.18.0 documents this operand and it never fired, on any fixture probed (.md).

**Consequence.** It is omitted from the vocabulary, so `verify` rejects it. A rule written from the documentation would otherwise load, run, and match nothing, with no error reported anywhere.

### `scope: frontmatter`

This operand fired and Vale 3.18.0 documents it nowhere.

**Consequence.** It is included in the vocabulary. It is also the standing counterexample to trusting the candidate list: a real operand nobody proposes is simply absent, and the schema then rejects a rule the binary honors.

### `scope: frontmatter.title`

This operand fired and Vale 3.18.0 documents it nowhere.

**Consequence.** It is included in the vocabulary. It is also the standing counterexample to trusting the candidate list: a real operand nobody proposes is simply absent, and the schema then rejects a rule the binary honors.

### `extends: consistency`

This check accepted 'taskless_generator_sentinel', a key no check has. It does not validate its keys at all.

**Consequence.** The schema is permissive here. Being strict would reject rules the binary runs, to catch a typo that costs nothing but a field quietly ignored — the too-strict direction, which is the worse failure.

### `extends: spelling`

This check accepted 'taskless_generator_sentinel', a key no check has. It does not validate its keys at all.

**Consequence.** The schema is permissive here. Being strict would reject rules the binary runs, to catch a typo that costs nothing but a field quietly ignored — the too-strict direction, which is the worse failure.

### `field probes: membership inferred from a type complaint`

10 probes drew an E201 that was not an invalid-key list: capitalization.action: expected a map, got 'bool'; conditional.action: expected a map, got 'bool'; existence.action: expected a map, got 'bool'; metric.action: expected a map, got 'bool'; occurrence.action: expected a map, got 'bool'; readability.action: expected a map, got 'bool'; repetition.action: expected a map, got 'bool'; script.action: expected a map, got 'bool'; sequence.action: expected a map, got 'bool'; substitution.action: expected a map, got 'bool'.

**Consequence.** Each is recorded as a member: Vale recognized the key and objected to the probe's arbitrary value instead, which is membership evidence. They are listed so the inference is auditable rather than assumed.

## Every scope probed

| Operand             | Fixture | Documented | Verdict |
| ------------------- | ------- | ---------- | ------- |
| `text`              | `.md`   | yes        | fires   |
| `code`              | `.md`   | yes        | fires   |
| `raw`               | `.md`   | yes        | fires   |
| `heading`           | `.md`   | yes        | fires   |
| `heading.h1`        | `.md`   | yes        | fires   |
| `heading.h2`        | `.md`   | yes        | fires   |
| `heading.h3`        | `.md`   | yes        | fires   |
| `heading.h4`        | `.md`   | yes        | fires   |
| `heading.h5`        | `.md`   | yes        | fires   |
| `heading.h6`        | `.md`   | yes        | fires   |
| `heading.h7`        | `.md`   | no         | silent  |
| `paragraph`         | `.md`   | yes        | fires   |
| `sentence`          | `.md`   | yes        | fires   |
| `list`              | `.md`   | yes        | fires   |
| `blockquote`        | `.md`   | yes        | fires   |
| `link`              | `.md`   | yes        | fires   |
| `alt`               | `.md`   | yes        | fires   |
| `summary`           | `.md`   | yes        | fires   |
| `strong`            | `.md`   | yes        | fires   |
| `emphasis`          | `.md`   | yes        | fires   |
| `table`             | `.md`   | yes        | fires   |
| `table.header`      | `.md`   | yes        | fires   |
| `table.cell`        | `.md`   | yes        | fires   |
| `table.caption`     | `.html` | yes        | fires   |
| `table.row`         | `.md`   | no         | silent  |
| `figure.caption`    | `.html` | yes        | fires   |
| `meta`              | `.md`   | yes        | silent  |
| `meta.class.title`  | `.md`   | yes        | silent  |
| `frontmatter`       | `.md`   | no         | fires   |
| `frontmatter.title` | `.md`   | no         | fires   |
| `text.class.foo`    | `.html` | yes        | fires   |
| `comment`           | `.js`   | yes        | fires   |
| `comment.line`      | `.js`   | yes        | fires   |
| `comment.block`     | `.js`   | yes        | fires   |
| `comment.line`      | `.ts`   | yes        | fires   |
| `comment.block`     | `.ts`   | yes        | fires   |
| `fenced`            | `.md`   | no         | silent  |
| `banana`            | `.md`   | no         | silent  |
