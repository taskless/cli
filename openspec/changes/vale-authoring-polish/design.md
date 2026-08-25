## Context

`verify` runs three layers against an `sg` rule: the ast-grep JSON schema, the Taskless required fields, and then the tests. For a `vale` rule it runs the last two only. `packages/cli/src/rules/vale/verify.ts` is 318 lines of fixture behavior — bucket coverage, then which fixtures fired — plus a `level` check and the `.vale.ini` presence checks. Nothing reads the rule's structure.

That gap is not theoretical, and the engine does not close it. Measured against the pinned Vale 3.18.0:

| Rule defect                       | `verify`       | `test`                      | `check`                        |
| --------------------------------- | -------------- | --------------------------- | ------------------------------ |
| `level: bananas`                  | **reports it** | —                           | —                              |
| `extends: nonsense`               | `ok: true`     | "fail fixture did not fire" | silent                         |
| `scope: fenced`                   | `ok: true`     | "fail fixture did not fire" | silent                         |
| `tokens` on an `occurrence` check | `ok: true`     | `E201: has invalid keys`    | **every Vale rule suppressed** |

The two middle rows are the shape that matters. The author is told their pattern did not match, so they go and edit the pattern. The fourth row is worse in a different direction: Vale reads one assembled config per run, so one stray field takes the whole engine's reporting down.

The ast-grep side avoids this because ast-grep publishes `schemas/rule.json` per tag, and `packages/cli/scripts/fetch-ast-grep-schema.ts` pins it to the vendored version. Vale publishes nothing equivalent. Its repository has no `schemas/` directory; the machine-readable field knowledge exists behind the hosted MCP server at `api.vale.sh/mcp`, which is part of the paid Vale CMS product.

## Goals / Non-Goals

**Goals:**

- `verify` rejects a Vale rule whose `extends`, `scope`, or per-check fields the binary will not honor, before Vale is invoked.
- The schema's claims are held to the vendored binary, so a Vale upgrade fails loudly rather than silently invalidating them.
- The `create-vale-rule` recipe documents the silent failures, which is the only place they can be prevented for the cases a schema cannot see.

**Non-Goals:**

- Depending on Vale's hosted MCP server at author or verify time. It is remote and paid; `verify` must work offline.
- Validating regex _semantics_. Whether a token is too broad, or whether `landed on` also matches "the plane landed on time", is judgment. That belongs in the recipe.
- Changing what `check` reports for any rule that is valid today.
- Reworking the `.vale.ini`. Converting it to JSON and schema-validating it was considered and rejected — `verify` already catches both of its silent failures ("no `.vale.ini`, so nothing scopes it" and "never enables `<id>.<id>`"), which is what a schema there would buy.

## Decisions

### Hand-author the schema, pinned to `VALE_VERSION`

There is no upstream artifact to generate from, so the choice is between transcribing the docs and not having a schema. Transcribe — but treat the transcription as untrusted.

_Alternative considered: derive the schema by probing the binary at build time._ Attractive, because it cannot drift. Rejected because Vale does not report its accepted values; the only probe available is "author a rule and see whether it fires", which distinguishes "invalid" from "valid but did not match" only through a fixture that is itself hand-written. That is the vendor-contract test, and it belongs in the test suite rather than in a generator.

_Alternative considered: query the hosted MCP `explain_check` at build time and vendor the result._ Rejected. It makes a build step depend on a paid third-party service, and the output would still need pinning and checking.

### The vendor-contract test is what makes the transcription safe

`packages/cli/test/vale-vendor-contract.test.ts` already pins Vale's givens by invoking the vendored binary directly rather than through `runVale`. Extend it, so that every value the schema asserts is one the binary was measured accepting. A Vale bump that adds or removes a check type then fails a test that names the field, instead of leaving the schema quietly wrong.

This is the same relationship `capabilities.ts` already has with the format tiers, and the precedent is deliberate: an engine claim in this repository is quoted from a pinned binary rather than from release notes.

### `scope` is a grammar, not an enum

The recipe presents `scope` as a single value. Measured, the binary accepts a bare string, a list, `~` negation, and `&` chaining — `~code`, `[~code]`, and `text & ~code` all parse and behave. A schema modeling `scope` as a flat enum would reject valid rules, which is worse than the gap it closes, so the enum applies to the _operands_ and the schema accepts the operators around them.

The vocabulary is also larger than the recipe's list: `heading` with levels, the `table.*` and `figure.caption` forms, `list`, `paragraph`, `sentence`, `blockquote`, `alt`, `summary`, `raw`, the v3.17.0+ inline scopes (`link`, `code`, `strong`, `emphasis`), `text.class.<name>`, the v3.18.0+ `meta` and `meta.class.<kind>`, and `comment.line` / `comment.block`.

`scope` is the highest-value field in the schema, because it is the one field nothing downstream ever validates. An invalid scope is not an error anywhere in the stack — it is a rule that matches nothing.

### The corpus is the artifact; the schema is derived from it

The schema is a transcription, so the thing that makes it true is not how carefully it is written — it is a corpus of rule files, each run through **both** the vendored binary and the schema, asserting the two agree. Build the corpus first and let the schema fall out of it, rather than writing the schema and adding tests afterwards.

Each corpus entry is a minimal rule YAML plus the verdict the binary was measured giving it. The test asserts `schemaAccepts === binaryAccepts` for every entry, and both directions of disagreement are failures:

- **Schema accepts, binary rejects** — the gap this change exists to close.
- **Schema rejects, binary accepts** — worse, because it blocks work that would have functioned. This is the direction to be paranoid about, and it is why an unclear value is accepted rather than rejected.

**Deciding the binary's verdict is the tedious part, and it cannot be read off an exit code.** Vale does not report "this is not a scope." An unrecognized `extends` or `scope` parses clean and produces a rule that matches nothing — indistinguishable, from the outside, from a valid rule whose pattern did not fire. So every corpus entry needs a **positive control**: a fixture document the rule _must_ flag when the construct is valid. "Fired" then means accepted, "did not fire" means the binary ignored it, and `E201` means rejected outright. Three outcomes, not two.

That control has to be written per entry, because it depends on what the rule matches — a `scope: heading` entry needs a heading, a `scope: table.cell` entry needs a table. There is no way to generate it from the check type alone, and this is the bulk of the work.

Keep the corpus declarative — a table of `{ check, field, value, fixture, expected }` rather than a test per case — so that a Vale upgrade is a re-run rather than a re-authoring, and so a gap in coverage is visible as a missing row rather than as an absent test nobody notices.

_Alternative considered: assert the schema against the docs and skip the corpus._ Rejected. It would encode the same transcription twice and prove only that we copied consistently. The corpus is the only thing that can catch a docs page that is wrong or stale about the pinned version — and the docs are already inconsistent with the MCP guide about how many check types exist.

### Follow the `sg` shape rather than inventing one

`verify` already has a `schema` layer with a `LayerResult` and an error list. The Vale path reports through the same `VerifyResult`. Reuse both, so the two engines fail the same way and the JSON output shape does not gain a special case.

### Resolve the check-type count against the binary, not the docs

The docs enumerate eleven check types. The MCP guide says `scaffold_rule` covers twelve. Do not pick a number: enumerate against the vendored binary and record what was measured. An enum that omits a real check type rejects valid rules.

## Risks / Trade-offs

- **The schema drifts from a Vale upgrade.** → The corpus is re-run against the new binary and the disagreement names the field. This is the whole reason the corpus is a requirement rather than a nicety.
- **The corpus is the expensive part and will be under-built.** Every entry needs a hand-written positive control, and an entry that silently lacks one asserts nothing — it "passes" because nothing fired on either side. → Assert that each entry's control fires for at least one known-valid variant, so a control that can never fire is itself a test failure rather than a quiet pass.
- **The schema is stricter than the binary and rejects a valid rule.** → Worse than the gap it closes, because it blocks work that would have functioned. Mitigated by deriving every enumerated value from a measurement, and by the `scope` grammar decision above. When a value's status is unclear, accept it.
- **A rule in the wild fails `verify` after this lands.** → Only if it was already inert or already suppressing the engine. Both are defects the author wants to know about. No rule that reports findings today can start failing.
- **Recipe growth.** `create-vale-rule` is already the longest recipe, and this adds to it. → The additions are failure-mode statements with measurements attached, which is the material the recipe is densest in already. If length becomes the problem, the split is by engine surface, not by trimming the measured parts.

## Migration Plan

No migration. The schema layer is additive, and it only rejects rules that the engine was already going to ignore or fail on.

The stack lands forward in two units, per the proposal: the recipe text first, then the schema and its `verify` layer. If the second unit needs to be reverted, the first stands on its own.

## Measured against Vale 3.18.0

Everything below was obtained by authoring a rule and running the vendored
binary directly, in a temporary project with `BasedOnStyles =` so no bundled
style could contribute a finding. Where a verdict is "did not fire", a
known-valid control was run against the same document first.

### Twelve check types, and the binary says so itself

An `extends` outside the set is **not** silently ignored. Vale rejects the file,
exits 2, and names the whole set:

```
'extends' key must be one of [capitalization conditional consistency existence
occurrence repetition substitution readability spelling sequence metric script].
```

That resolves eleven-versus-twelve without a judgement call: **twelve**. The
docs' eleven omits `readability`, which they fold into `metric`; the binary
treats them as separate checks with disjoint fields (`metrics`/`grade` versus
`formula`/`condition`), and each rejects the other's.

### `scope` is a grammar, and the operand vocabulary is not the docs'

Measured firing: `text`, `code`, `raw`, `heading`, `heading.h1`–`h6`,
`paragraph`, `sentence`, `list`, `blockquote`, `link`, `alt`, `summary`,
`strong`, `emphasis`, `table`, `table.header`, `table.cell`, `table.caption`,
`comment`, `comment.line`, `comment.block`, `frontmatter`, `frontmatter.<key>`,
`text.class.<name>`.

Reach, on one document holding the token in prose, in an inline span, and in a
fenced block: `text` → 1, `code` → 1, `[code, text]` → 2, `raw` → 3. `raw`
subsumes the other two.

`~` negation, `&` chaining, and the list form all parse and behave. **A negation
over an unrecognized operand is a silent no-op** — `~fenced` and `text & ~fenced`
both fire on everything, so a typo inside a `~` removes the exclusion rather than
narrowing anything.

Two corrections to this document's own earlier draft:

- **There is no `meta` scope.** The v3.18.0 addition is `frontmatter` and
  `frontmatter.<key>`, which is what the binary carries (`text.frontmatter.`)
  and what fires. `meta` and `meta.class.<kind>` never fired in Markdown,
  MDX, or HTML.
- **`figure.caption` fires, but only once you find a control it can reach.**
  The obvious control — a `<figcaption>` nested inside `<figure>` — never fires,
  and neither does a `scope: text` control over the same document: Vale drops
  everything inside a `<figure>` element before any check runs. A bare
  `<figcaption>` is linted normally, and `scope: figure.caption` fires on it in
  both HTML and Markdown. This is the case task 5.4 exists for: without the
  known-valid control alongside it, the first result would have been recorded as
  "the binary ignores this scope" and the operand wrongly dropped from the enum.
  (AsciiDoc and reStructuredText, the other formats with figure captions, need
  `asciidoctor`/`rst2html`, which Taskless excludes.)

### Per-check fields, and two checks that validate nothing

Every check accepts `extends`, `message`, `level`, `scope`, `link`, `limit`,
`action`, `description`, `name`. `vocab` is accepted by `existence`,
`substitution`, `capitalization`, `conditional`, `repetition` and **rejected**
by `occurrence`, `metric`, `readability`, `script`, `sequence`.

The per-check additions are in the recipe's table. Three published claims are
wrong against the binary: `capitalization` takes `prefix` (singular) and rejects
`prefixes` and `suffixes`; `capitalization` rejects `ignorecase`; `occurrence`
rejects `exceptions` and `vocab`.

**Field keys are matched case-insensitively — but `extends`, `message` and
`level` are not.** Vale decodes a check's own fields through a case-insensitive
map, so `Tokens:` and `ignoreCase:` are read exactly as their lowercase
spellings. The three header keys are read separately and literally: `EXTENDS:`
fails with "Missing the required 'extends' key". Their _values_ are
case-sensitive too — `level: WARNING` and `extends: Existence` are both
rejected. The schema therefore compares field names case-insensitively and
`extends`/`level` values exactly, which is what the binary does.

**`consistency` and `spelling` accept any key at all.** `bananafield: true` on
either loads without complaint and is ignored — they do not use the strict
decode the other ten do. The schema cannot be strict about their fields without
rejecting rules the binary accepts, so it is not.

### The failure modes, re-measured

| Rule defect              | Binary                                           |
| ------------------------ | ------------------------------------------------ |
| `extends: nonsense`      | rejected, exit 2, **every** Vale rule unreported |
| foreign field            | `E201`, exit 2, **every** Vale rule unreported   |
| `scope: fenced`          | loads, runs, matches nothing — no error anywhere |
| style file named `.yaml` | not loaded at all — no error, no warning         |

**One row of the table in Context is wrong and is corrected here.** It claimed
`extends: nonsense` "verifies clean and simply matches nothing". Against 3.18.0
it does not: it is the same engine-wide suppression as `E201`. The genuinely
silent case is `scope`, alone — which makes `scope` the highest-value field in
the schema for exactly the reason the decision above gives, and makes the other
two a blast-radius argument rather than a silence argument.

## Open Questions

- **How much of the per-check field table to encode.** The full table makes `E201` unreachable; a partial one still leaves the engine-wide suppression possible for the fields it omits. Recommend the full table, since `E201` is the failure with the widest blast radius, but the cost is that every check type must be transcribed and measured rather than just the common header.
- **Whether `verify` should also report each matcher's selected-file count.** Out of scope here, but adjacent: a matcher glob that reaches nothing produces a rule that is well formed, enabled, green, and inert — the one silent failure this change does not close.
