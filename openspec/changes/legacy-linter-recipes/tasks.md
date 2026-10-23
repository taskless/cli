## 1. Detect counts custom rules (PR 1)

- [x] 1.1 Add the per-linter custom-rule count and its evidence to the detect output schema. Verify the schema test validates a payload with and without counts, and that existing fields are unchanged.
- [x] 1.2 Count ESLint custom rules statically: rules in a house rule directory, and an unknown count for a plugin imported from a local file, an inline plugin, or a local-rules loader package. Verify fixture-repo tests for a rule directory, an imported plugin, an inline plugin, and a preset-only config (zero).
- [x] 1.3 Count Biome `plugins` entries across root and nested configs, pylint `load-plugins` modules that resolve inside the repository (excluding `pylint.extensions.*`), and flake8 `[flake8:local-plugins]` checkers. Report Ruff as zero. Verify a fixture-repo test per tool, including a pylint config naming only built-in extensions (zero).
- [x] 1.4 Confirm detect still executes nothing and makes no network call with the new scan. Verify the existing offline test passes.

## 2. Route ladder and linter paragraphs (PR 1)

- [x] 2.1 Add a `%(LEGACY_LINTERS)s` slot to `route`, rendered at serve time from a detect scan with one paragraph per detected linter that has a legacy recipe, and the full set when `mechanics` is off. Verify recipe tests: a Ruff-only fixture renders only the Ruff paragraph, a `prettier`-only fixture renders none, and the mechanics-off path renders all five.
- [x] 2.2 Rewrite `route.md` as topic v8: the four-step ladder, step 1 always taken, step 2 gated on the five-rule count, legacy and static no longer posed as a choice. Verify the recipe tests for each scenario in the `cli-rule-routing` delta, and that "Every destination resolves to a recipe" still passes.
- [x] 2.3 Rewrite generic `create-legacy-rule.md` as topic v3: shipped rule first, custom rule only with five or more repository examples and modeled on them, a missing plugin added only with consent, and the hand-off naming who runs the rule. Verify the recipe tests for each `cli-legacy-rule-recipes` scenario that applies to the generic recipe.
- [x] 2.4 Update `onboard.md` to topic v11: legacy candidates use shipped rules from installed packages only, with no custom rules and no new dependencies. Verify the `cli-onboard` delta scenarios and the onboard byte-parity tests.
- [x] 2.5 Add the changeset (`patch`) describing the ladder and the detect count. Run `pnpm typecheck` and `pnpm lint`; both pass.

## 3. The `--tool` flag (PR 2)

- [ ] 3.1 Collect `create-legacy-rule.<tool>.md` variants at build time with the same glob mechanism as `.anonymous`, and add `--tool` to the agent command's value flags. Resolve `--tool` before `--anonymous`. Verify tests: a known tool serves its variant, an unknown tool falls back to the generic recipe, `--tool` as `--tool x` and `--tool=x` both parse, and the positional parser does not read the value as a topic.
- [ ] 3.2 Refuse `ast-grep`, `vale`, `prettier`, `black`, and `anonymous` with a non-zero exit that names the right recipe. Verify a test per refused name.
- [ ] 3.3 Make the `route` paragraphs name `create-legacy-rule --tool=<name>`. Verify the "Shipped recipes name only commands that exist" check passes for every rendered paragraph.

## 4. Per-tool recipes (PR 2)

- [ ] 4.1 Write `create-legacy-rule.ruff.md`: `banned-api` first, web discovery confirmed with `ruff rule`, preview status checked, the 0.16 default-set change, `extend` and nested configs, and how to run Ruff. Verify recipe tests for the Ruff scenarios.
- [ ] 4.2 Write `create-legacy-rule.eslint.md`: core rules and the `no-restricted-*` catch-alls first (including `@typescript-eslint/`), the eight curated plugins each with a summary and docs link, installed plugins preferred, the ESLint 10 peer gap and `import-x`, flat config against `.eslintrc`, and how to run ESLint. Verify recipe tests that every plugin has a summary and URL and that no individual plugin rules are listed.
- [ ] 4.3 Write `create-legacy-rule.biome.md`: an existing rule first, `noRestrictedImports`/`noRestrictedGlobals` as the catch-alls, web discovery confirmed with `biome explain`, nested configs and `extends`, and how to run Biome. Verify the recipe tests.
- [ ] 4.4 Write `create-legacy-rule.pylint.md`: `--list-msgs`/`--help-msg` with the `--load-plugins` trap, `deprecated-modules`/`preferred-modules`/`bad-functions`, config search order, and how to run pylint. Verify the recipe tests.
- [ ] 4.5 Write `create-legacy-rule.flake8.md`: no discovery step, `banned-modules` from `flake8-tidy-imports` (a dependency that needs consent), the three config files, and how to run flake8. Verify the recipe tests.
- [ ] 4.6 Add vendor tests that run each tool at a pinned version and assert every behavioral claim the recipes make: the `preview` field in `ruff rule --output-format json`, `ruff rule TID251`, `biome explain` output, `pylint --help-msg` failing without and succeeding with `--load-plugins`, and `--banned-modules` in `flake8 --help` with the plugin. Verify they pass locally and in CI, and fail when a claim is edited to be false.
- [ ] 4.7 Extend the changeset with `--tool` and the five recipes. Run `pnpm typecheck` and `pnpm lint`; both pass.

## 5. Archive (PR 2, tip)

- [ ] 5.1 Run the pre-archive check from CLAUDE.md (commit, keep the SHA, `pnpm openspec archive legacy-linter-recipes -y`, confirm every prior scenario of `cli-rule-routing`, `cli-agent`, `cli-detect`, and `cli-onboard` survives, then reset to the SHA).
- [ ] 5.2 Archive for real. Verify `pnpm openspec validate --strict` passes on the result.
