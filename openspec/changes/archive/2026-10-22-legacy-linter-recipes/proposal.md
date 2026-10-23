## Why

When a repository already runs a linter, `create-legacy-rule` hands the agent 64 generic lines that say "mine the repo, then search the web". Each agent works out every linter's dialect from scratch, so it misses rules the tool already ships, gets traps like preview-only rules wrong, and writes rules into tools the team does not maintain. We are adding linters, and teaching an agent to author rules for hundreds of them is not sustainable. What is sustainable is teaching it to use what each tool already has.

## What Changes

- **A legacy ladder replaces the open-ended legacy destination.** For a request in a repository with a detected linter, `route` applies these steps in order:
  1. **Always: would a rule the tool already ships solve this?** Each tool has a step it always takes. Ruff always tries `banned-api` (TID251). ESLint always tries a built-in rule, then a curated plugin list. Biome always checks whether an existing rule makes the problem go away.
  2. **Only when the repository already has five or more of its own custom rules for that linter:** author another one, using those rules as the reference examples, not the tool's documentation.
  3. A Taskless `sg` or `vale` rule.
  4. A Taskless runtime rule.
- **Taskless does not teach linter rule authoring.** The legacy recipes carry no instructions for writing a custom ESLint rule, a pylint checker, a flake8 plugin, a Biome GritQL or JS plugin, or anything else. Step 2 learns only from the repository's own examples. A check that needs custom code and has no such examples belongs to Taskless.
- **Onboarding skips step 2 and never adds a dependency.** Onboarding runs logged out and writes no executable code, so it uses only step 1, and only with rules from packages the repository already has installed. A plugin that is not installed is something to recommend outside onboarding, after the user agrees to add it.
- **`taskless agent create-legacy-rule --tool=<name>`** returns a per-tool recipe. `<name>` is the linter `name` that `detect --json` reports. An unknown tool falls back to the generic recipe. Tools that cannot hold a rule of this kind (`ast-grep` and `vale`, which have their own recipes, and the formatters `prettier` and `black`) are refused with a pointer to the right recipe.
- **Per-tool recipes at launch: Ruff, ESLint (including typescript-eslint), Biome, pylint, flake8.** TSLint is not supported. Each recipe covers how to find an existing rule for a request, the tool's catch-all rules, version-specific traps, and how to run the tool so the user can see the rule fire:
  - **Ruff and Biome:** find a rule by web search of the rules page, then confirm it against the installed version with `ruff rule <name>` or `biome explain <rule>`. Both tools have too many rules to match a request against locally. Ruff marks preview-only rules, and enabling one without `preview = true` means it never fires.
  - **ESLint:** core rules first, with `no-restricted-syntax` and `no-restricted-imports` (and their `@typescript-eslint/` versions) as the catch-alls. Then a curated list of eight plugins, each with a one-line summary and a docs link.
  - **pylint:** `--list-msgs` and `--help-msg`, with `deprecated-modules`, `preferred-modules`, and `bad-functions` as the catch-alls.
  - **flake8:** no discovery step. The catch-all is `banned-modules` from `flake8-tidy-imports`.
- **`detect` counts the repository's own rules per linter.** `detect --json` adds a count of custom rules for each linter, which is the signal step 2 reads. The count covers local ESLint plugins and rule directories, Biome `plugins` entries, pylint `load-plugins` modules inside the repository, and flake8 `[flake8:local-plugins]`. Built-in extensions and third-party packages do not count. Neither does a config file on its own.
- **`route` gives a paragraph to each linter it detects.** The CLI renders each paragraph at runtime, and only for linters `detect` found. Each one says what the tool is for, what it always tries first, and the `--tool` command to fetch.
- **The catalog prohibition is lifted, narrowly.** The standing requirement says `create-legacy-rule` SHALL NOT embed a Taskless-maintained catalog of linter rules. The curated ESLint plugin list and each tool's named catch-all rules are a catalog, so that line changes to allow a short, curated, linked list of rule sources. It still forbids a catalog of individual rules.
- **`route` stops asking the user when both legacy and a Taskless rule fit.** The ladder's order decides instead. This also resolves a conflict with onboarding, which told the agent not to ask.
- Topic versions bump: `route` v7 → v8, `create-legacy-rule` v2 → v3, `onboard` v10 → v11.

## Capabilities

### New Capabilities

- `cli-legacy-rule-recipes`: the `--tool` per-tool variants, the five launch recipes and what each must cover, the generic fallback, refused tools, and the rule that legacy recipes do not teach rule authoring.

### Modified Capabilities

- `cli-rule-routing`: "Existing recipe authors in the detected linter's dialect" is restated for the ladder and the narrowed catalog line. "Route asks the user when multiple paths fit" no longer poses legacy against static as a choice. A new requirement covers the ladder and the per-linter paragraphs.
- `cli-detect`: a new requirement covers the per-linter custom-rule count. "No packaged-rule catalog matching" is unchanged, because the curated list lives in recipes and is not part of detection.
- `cli-agent`: "Agent subcommand serves recipes for commands" gains the `--tool` flag and its resolution order.
- `cli-onboard`: a new requirement limits onboarding to step 1, with installed packages only.

## Delivery Shape

**Stacked, merging forward.** Each PR is safe in production on its own:

1. **The `detect` custom-rule count, the ladder in `route`, the per-linter paragraphs, and the generic `create-legacy-rule` v3 and onboard v11 that follow the ladder.** The paragraphs name only `create-legacy-rule` here, so nothing references a variant that does not exist yet. The changeset lands on this PR.
2. **`--tool`, the five per-tool recipes and their vendor tests.** The `route` paragraphs start naming `--tool=<name>`. This PR archives the change.

The package is pre-1.0 and every surface here is additive or recipe text, so the bump is `patch`.

## Impact

- **Code**: `packages/cli/src/detect/scan.ts` and the detect schema; `packages/cli/src/commands/agent.ts` (the `--tool` flag); `packages/cli/src/prompts/recipes.ts` (variant lookup, runtime-rendered linter paragraphs); `packages/cli/src/agent/` (`route.md`, `create-legacy-rule.md`, `onboard.md`, five new `create-legacy-rule.<tool>.md` files).
- **Tests**: vendor tests that pin each recipe's claims against a real install of that linter (preview status in `ruff rule --output-format json`, `--help-msg` needing `--load-plugins`, `biome explain` output). These need Ruff, Biome, pylint, flake8, and ESLint available in CI.
- **No new runtime dependency** for the CLI. Recipes recommend plugins; the CLI installs nothing.
- **Research**: the per-tool signals and traps come from official docs and measured runs, recorded in `design.md` with the source for each.
