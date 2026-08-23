Delivery shape: **stacked, merging DOWN**, five PRs. Group 1 is the bottom branch and carries the OpenSpec proposal and the single changeset. Groups 2–5 stack above it, each based on its parent branch. The stack merges down from the tip and reaches `main` as one protected merge, because no intermediate state is green: a recipe carrying `%(TASKLESS_CLI)s` without the renderer fails the unresolved-placeholder assertion, and the renderer alone ships a variable no recipe uses.

## 1. PR 1 (bottom) — the renderer, the variable, and the API

- [x] 1.1 Add the OpenSpec change under `openspec/changes/full-cli-invocation/` and validate it with `pnpm openspec validate full-cli-invocation --strict`
- [x] 1.2 Add the changeset on this branch, **before cutting any child branch** — inheritance only runs forward in time, and a changeset written on a child never reaches the branches below it
- [x] 1.3 Add `TASKLESS_CLI_MARKER = "<taskless-cli>"` and the three-step resolution (`options.invocation` → non-prod `__TASKLESS_CLI__` → marker) to the variable table in `src/prompts/recipes.ts`. Export the prod-invocation constant from `src/util/invocation.ts` so `recipes.ts` can ask "is this build prod?" without restating the string
- [x] 1.4 Add `invocation?: string` to `RecipeOptions`, documented the way `packageManagerDlx` is
- [x] 1.5 Split rendering into a variables-table builder and a renderer, and add `collectVariables(template)`: render against a `Proxy` whose `get` trap records the requested name and whose `has` trap returns `true`, then **discard the rendered output**. `%%` has already collapsed to `%` in it
- [x] 1.6 Add `getRawRecipe(topic, options?)` beside `getRecipe`, returning `{ text, variables }` where `text` is `applyCliInvocation(source)` with the header handled identically to the rendered path. The invocation rewrite belongs in raw text: it is build-target substitution, not templating, and leaving it out would break the round-trip
- [x] 1.7 Export `getInstructions` and `getRawInstructions` from `src/prompts/index.ts`, both throwing on an unknown topic with the same packaging-fault message `getPrompt` uses. Wrap `getRecipe`/`getRawRecipe` — do not duplicate the render path
- [x] 1.8 Tests: round-trip (`sprintf(raw.text, vars) === rendered.text`) for every canonical topic; `%%` preserved in raw and collapsed in rendered; `variables` identical between the two accessors; a prod build with no `invocation` renders `<taskless-cli>`; a supplied `invocation` renders verbatim; both accessors throw on an unknown topic while `getRecipe` still returns `undefined`

## 2. PR 2 — launcher detection and the `getCliPrefix` fix

- [x] 2.1 Rewrite `src/util/package-manager.ts` around `detectLauncher({ env, argv })`, pure over an injected context. Recognize npx (`_npx` path segment in `argv[1]`, or `npm_command === "exec"` with `npm_lifecycle_event === "npx"`) and pnpm dlx (`pnpm/` user agent **and** a `dlx` path segment). Everything else is `undefined`
- [x] 2.2 Derive the package specifier from `__TASKLESS_CLI__`: a `npx `-prefixed invocation yields its specifier (pinned to `@latest` when it carries no version), and a path-form invocation is returned verbatim with no launcher applied
- [x] 2.3 Reimplement `getCliPrefix()` over the two, keeping `npx <spec>` as the display default when detection is unknown. The five call sites are unchanged
- [x] 2.4 Pass `invocation: detectCliInvocation(...)` from `src/commands/agent.ts` into `getRecipe`
- [x] 2.5 Rewrite `test/package-manager.test.ts` as a table over injected contexts — its current premise, that the user agent answers the question, is what this change refutes. Cover npx by path, npx by env, pnpm dlx, pnpm run (must not be dlx), pnpm exec, a `node_modules/.bin` shim, and an empty environment
- [x] 2.6 Confirm `test/prompts.test.ts`'s spawned-CLI byte-parity still holds: the test spawns `node dist/index.js` under a pnpm-run environment, which detection must report as unknown, so the CLI and the export both render the marker

## 3. PR 3 — recipe normalization, part A

- [ ] 3.1 Replace every bare `` `taskless <subcommand>` `` and every `npx @taskless/cli <subcommand>` with `%(TASKLESS_CLI)s <subcommand>` across the heaviest recipes. Leave prose mentions of the product, `taskless.config`, and `.taskless/` alone
- [ ] 3.2 Leave `ci.txt`'s `%(PACKAGE_MANAGER_DLX)s` occurrences in place — they answer what the _consuming repo's_ CI should type, which is a different question from how this process was launched. Its one prose reference to `npx @taskless/cli` becomes `%(TASKLESS_CLI)s`
- [ ] 3.3 Note in the PR body that `onboard.txt` conflicts with PR #142, which lands first

## 4. PR 4 — recipe normalization, part B

- [ ] 4.1 Normalize the remaining recipes the same way
- [ ] 4.2 Normalize `skills/taskless/SKILL.md` and `commands/tskl/tskl.md`. These are not rendered through the recipe renderer, so they keep the literal `npx @taskless/cli` that `applyCliInvocation` already rewrites — verify which of the two treatments each file needs rather than assuming
- [ ] 4.3 Verify no recipe still names a bare `taskless` binary

## 5. PR 5 (tip) — cross-reference checking and the archive

- [ ] 5.1 Move `test/recipe-cross-references.test.ts` from scanning recipe source to scanning rendered recipes, where the invocation is a stable literal. Match the marker alongside the existing spellings
- [ ] 5.2 Add the regression guard: no bare `` `taskless <subcommand>` `` in any `src/agent/*.txt`, naming the offending file and line
- [ ] 5.3 Archive the change to `openspec/changes/archive/<date>-full-cli-invocation/`
- [ ] 5.4 Run every gate on the tip: build, test, typecheck, lint, `openspec validate --strict`
