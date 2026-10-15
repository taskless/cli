## 1. Shared fixture passage

- [x] 1.1 Add a `FIXTURE_SOURCES` block to `buildVariables` in `packages/cli/src/prompts/recipes.ts`, rendered through `indentBlock`. It covers real code first, disclosing invented fixtures, reading the detected linters, and varying only on the rule's axis, with no placeholder types or nesting the repo would reject. With mechanics on it says to reuse or run `detect --json`; with mechanics off it uses the supplied-evidence wording. Verify by adding `FIXTURE_SOURCES` to the variable list in `test/prompts.test.ts` and running that test.
- [x] 1.2 Add `prompts.test.ts` cases asserting that, with mechanics on, the rendered block names the `detect --json` invocation, and that with `mechanics: false` it names no command. Verify with `pnpm --filter @taskless/cli test prompts`.

## 2. Recipes that write fixtures

- [x] 2.1 Insert `%(FIXTURE_SOURCES)s` into the fixture step of `create-sg-rule.md` (step 6), replacing the weaker "drawn from real code where you can" phrasing. Verify the rendered `agent create-sg-rule` output keeps its numbered-list indentation.
- [x] 2.2 Insert it into `create-vale-rule.md` step 5, and state that a `pass/` near-miss is idiomatic prose varying only on the rule's axis. Verify the rendered output and that the existing near-miss bullets are unchanged.
- [x] 2.3 Insert it into `create-runtime-rule.md`'s "Testing a rule you wrote yourself" section, with whatever placement that section's indentation needs. Verify the rendered output.
- [x] 2.4 Insert it into `improve-rule.anonymous.md` step 5, so added cases follow the same bar. Verify the rendered output.

## 3. Recipes that submit cases

- [x] 3.1 Add one bullet to `create-remote-rule.md` step 4: submitted success and failure cases follow the same sourcing and idiom bar, and success cases should be ones the detected linters would accept. Verify the rendered output.
- [x] 3.2 Add the same bullet to `improve-rule.md` step 5 for the references. Verify the rendered output.

## 4. Release and checks

- [x] 4.1 Add a `patch` changeset for `@taskless/cli` that describes the recipe change from a consumer's point of view. Verify that `.changeset/` holds exactly one new file.
- [x] 4.2 Run prettier only on the changed `.ts` and changeset files, by explicit path. Never run it on `src/agent/*.md` or over `src/`, because it rewrites the recipe markdown. Then run `pnpm typecheck` and `pnpm lint`. Both must pass.
- [ ] 4.3 Run `pnpm build`, then author one sg rule with `pnpm cli agent create-sg-rule` in a scratch repo that has an ESLint config. Confirm the fixtures come from real code, the passing cases pass ESLint, and the report names any invented fixture. Record the result in the PR body.
