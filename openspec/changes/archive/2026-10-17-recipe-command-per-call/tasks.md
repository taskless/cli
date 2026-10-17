## 1. Shared paragraph

- [x] 1.1 Add the `ONE_COMMAND_PER_CALL` variable to `buildVariables()` in `src/prompts/recipes.ts`, rendered from the resolved invocation
- [x] 1.2 Place `%(ONE_COMMAND_PER_CALL)s` beneath the header of all 26 standalone recipes (not the `feedback-invite` fragment, which is appended under a recipe that already carries it) and bump those topic versions
- [x] 1.3 Rewrite the chained examples in `check.md` and `create-vale-rule.md`
- [x] 1.4 Add a `prompts.test.ts` case for every topic, with and without the header; update the topic-version assertions

## 2. Release

- [x] 2.1 Add a `patch` changeset; run `pnpm typecheck`, `pnpm lint`, and the full test suite
- [x] 2.2 Run the pre-archive scenario check from CLAUDE.md, then archive the change
