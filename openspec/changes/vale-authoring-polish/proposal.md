## Why

A Vale rule that is _malformed_ fails loudly. A Vale rule that is _wrong_ passes `verify`, passes `test`, and reports nothing forever — and nobody re-checks a green rule. Authoring the first house-style rules against this repository produced three of those in a row, each green on every local gate:

- An em-dash rule whose token can never match, because Vale wraps tokens in word boundaries and an em dash is non-word on both sides. It needed `nonword: true`, which nothing asked for.
- A rule about a shell command that caught zero of two real violations, because commands in a README live in fenced blocks and Vale skips those by default.
- A rule scoped to `packages/cli/src/**/*.ts` whose clean report was indistinguishable from a matcher glob that reached nothing.

Measured against the pinned Vale 3.18.0, the engine does not close these. `extends: nonsense` and `scope: fenced` both pass `verify` and simply match nothing; a field belonging to a different check type throws `E201`, which takes **every** Vale rule in the project down because Vale reads one config per run. The `create-vale-rule` recipe carries the knowledge that exists, but it is incomplete in the specific places that produce silent rules.

## What Changes

- **`verify` validates a Vale rule file structurally**, before Vale sees it, against a schema that models the check types and their fields. Today it validates `level` and the presence of the rule's `.vale.ini`, and nothing else — `extends: nonsense` verifies clean.
- **The schema is hand-authored and pinned to `VALE_VERSION`**, because there is nothing to generate it from. Vale publishes no JSON Schema; the machine-readable field knowledge exists only behind its paid cloud MCP at `api.vale.sh/mcp`, which `verify` cannot depend on. The vendor-contract test is what stops the schema drifting from the binary.
- **`scope` gains a real enum**, including the hierarchical forms, the v3.17.0+ inline scopes, and the v3.18.0+ `frontmatter` scopes — and accepts the `~` negation and `&` chaining syntax that the recipe never documents and that a naive enum would reject.
- **The `create-vale-rule` recipe closes the gaps that produce silent rules**: the measured scope table, `nonword` for punctuation tokens, how to scope a rule _out_ (the recipe only explains scoping in), fixture design for a subject that normally appears in code, and the `limit`/`vocab` fields it omits.
- **No breaking change.** Every rule that verifies today continues to verify; the schema only rejects rules the engine was already going to ignore or fail on.

## Capabilities

### New Capabilities

None. This tightens two existing capabilities rather than introducing a surface.

### Modified Capabilities

- `cli-rule-validation`: the `verify` component table currently says a Vale rule is checked "against Vale's own validation." Measured, that covers `level` and not `extends` or `scope`. The requirement changes to name schema validation as its own layer for `vale`, matching how `sg` is already checked against the ast-grep schema.
- `cli-agent-authoring`: the Vale authoring recipe requirement gains the scope, token, and fixture guidance whose absence is what produces a green-but-inert rule.

## Impact

- `packages/cli/src/rules/vale/verify.ts` — today entirely fixture behavior (bucket coverage, which fixtures fired); gains a schema layer.
- A new generated-or-authored schema artifact alongside `packages/cli/src/generated/ast-grep-rule-schema.json`, plus whatever pins it to `VALE_VERSION`.
- `packages/cli/test/vale-vendor-contract.test.ts` — extended to hold the schema's claims against the pinned binary.
- `packages/cli/src/agent/create-vale-rule.txt` — the recipe text.
- Closes #171 and #170; #167 is the worked case that motivated both.

## Delivery shape

**Stacked, merging forward.** Two units, each independently safe in production:

1. **The recipe gaps.** Text only, no behavior change, and it is the half that helps an author today. It can land alone.
2. **The schema and its `verify` layer.** Code, tests, and the vendor-contract additions.

Landing 1 alone leaves `check`, `verify`, and the test suite exactly as they are, so the stack merges forward rather than down. The changeset goes on the bottom branch and grows as the second unit lands.
