Delivery shape: **single PR**. Constants, recipe text, spec delta, and tests are one diff — the constants exist only to be rendered, and the recipe text is wrong without them, so no slice lands independently.

## 1. Constants

- [x] 1.1 Add `packages/cli/src/rules/capabilities.ts` with the ast-grep language list verbatim from `sg run -h` at the pinned `0.41.0`, and the pinned version beside it
- [x] 1.2 Probe the shipped Vale 3.17.1 binary for its tiers rather than trusting any prior table, and record markup, comment-only, and converter-dependent extensions with the converter each failure names
- [x] 1.3 Keep the module free of imports entirely, so `assert-prompts-graph` still passes when `src/prompts/recipes.ts` reaches it
- [x] 1.4 Add the render helpers that turn each list into recipe prose, so a recipe never joins an array itself

## 2. Recipes

- [x] 2.1 Extend `buildVariables` with `AST_GREP_VERSION`, `AST_GREP_LANGUAGES`, `VALE_VERSION`, `VALE_MARKUP_FORMATS`, `VALE_COMMENT_FORMATS`, and `VALE_CONVERTER_FORMATS`
- [x] 2.2 Bump `route.txt` to topic v2 and add the reach block to step 4, after the engine table's sharpening bullets and before the worked examples
- [x] 2.3 State in `route.txt` that a language on neither list is not automatically runtime, and that `create-legacy-rule` is checked first
- [x] 2.4 Separate reach from availability in `route.txt`'s Important Notes — the existing "availability you can assert" bullet is about the binary resolving on this host, which the new lists do not answer
- [x] 2.5 Bump `create-vale-rule.txt` to topic v3, repeat the reach at the matcher step, and replace the `[*.{md,mdx}]` widening example

## 3. Tests

- [x] 3.1 Add an `ast-grep engine capabilities` block parsing `Supported languages are: [...]` and asserting set-equality, with `Yaml` named explicitly so the issue's answer is an assertion rather than an implication
- [x] 3.2 Add a `Vale engine capabilities` block that probes each tier with a discriminating fixture — a construct only a parser skips for markup, a bare non-comment line for comment-only, a non-zero exit with `E100` for converter-dependent
- [x] 3.3 Assert in `recipe-cross-references.test.ts` that no rendered recipe leaks a `%(…)s` marker and that rendered `route.txt` carries the lists
- [x] 3.4 Extend the `buildVariables` key list and the prompts import allowlist in `prompts.test.ts`

## 4. Verification

- [x] 4.1 `pnpm openspec validate engine-reach-in-route --strict`
- [x] 4.2 `pnpm --filter @taskless/cli build` — the prompts-graph plugin is the real check that `capabilities.ts` stayed pure
- [x] 4.3 `pnpm typecheck`, `pnpm lint`, and `pnpm --filter @taskless/cli test`
- [x] 4.4 Add the changeset
