## 1. Detection

- [x] 1.1 Add `packages/cli/src/detect/host-tools.ts`: per-tool
      `{ name, present, path?, applicable }` for `gh`, `git`, `jq`,
      via `findOnPath`, with `gh` not applicable when `ghOwner` is
      `UNKNOWN_GH_OWNER`. Executes nothing.
- [x] 1.2 Keep it a leaf: no imports beyond `findOnPath` and the
      repository-context resolver.

## 2. `info --json`

- [x] 2.1 Rename the `tools` key to `harnesses` in
      `packages/cli/src/schemas/info.ts` and
      `packages/cli/src/commands/info.ts`.
- [x] 2.2 Add the new `tools` array carrying detected CLI binaries.
- [x] 2.3 Update every in-repo consumer: the `info` recipe's example
      payload and `packages/cli/test/cli.test.ts`.

## 3. Recipe variables

- [x] 3.1 Add `RecipeOptions.hostTools` and the whole-block variables
      to `packages/cli/src/prompts/recipes.ts`, defaulting to the full
      menu when absent.
- [x] 3.2 Keep the prompts graph Worker-safe (type-only import).

## 4. Recipe

- [x] 4.1 Rewrite `onboard.md` step 3's source menu: presence not
      verification, no `command -v gh`, tracker-agnostic bullet.
- [x] 4.2 Rewrite step 4 to report what was found.
- [x] 4.3 Bump the topic version.

## 5. Wiring

- [x] 5.1 Detect and pass in `commands/onboard.ts`.
- [x] 5.2 Detect and pass in `commands/agent.ts`, gated on the
      template's own variable list.

## 6. Tests

- [x] 6.1 Detection: present / absent / non-GitHub, and precedence.
- [x] 6.2 Rendered recipe in each state; tools-absent mentions no `gh`.
- [x] 6.3 Byte-parity between the two serving paths in every state.
- [x] 6.4 `prompts` export renders the full menu with no options.
