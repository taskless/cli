## Context

`route` already names `create-legacy-rule` for "a tool the repo already runs", onboarding lists `legacy` as a candidate destination, and the report has a `legacy` section that counts toward its three-rule gate. The gap is the recipe, which is generic and teaches nothing tool-specific. See proposal.md for motivation.

Constraints that shape the approach:

- Recipes are embedded at build time (`src/prompts/recipes.ts`). Variants already exist as `<topic>.anonymous.md`, selected by `--anonymous`.
- `route` already has runtime-rendered slots (`%(DETECT_EVIDENCE)s`, `%(HOST_TOOLS)s`), so a per-linter paragraph is the same mechanism with a new slot.
- `detectRuleStyles` (`src/detect/scan.ts`) only recognizes ESLint local rule directories and plugin packages, and reports styles, not counts.
- Unlike Vale and ast-grep, Taskless does not pin these linters. The installed version is whatever the repository has, so recipe claims must hold across the versions a repository is likely to run, or say where they diverge.

## Goals / Non-Goals

**Goals:**

- An agent that reaches a legacy destination finds and enables an existing rule correctly, including the traps for its tool and version.
- The decision to write a new custom rule rests on a count the CLI computes, not on the agent's impression.

**Non-Goals:**

- Teaching rule authoring for any linter. Step 2 learns from the repository's examples only.
- Running external linters from `taskless check`.
- Recipes for linters beyond the five launch tools. The generic recipe still covers them.
- Matching a request to a named rule inside the CLI. That stays the agent's job, so `detect`'s "no packaged-rule catalog matching" requirement is unchanged.

## Decisions

**Per-tool variants reuse the `.anonymous` mechanism, keyed by `detect`'s linter name.** `create-legacy-rule.<tool>.md` files are collected by the same glob. `--tool` takes precedence over `--anonymous`, since no legacy recipe has an anonymous variant. Keying on `detect`'s `name` means the agent copies a value from JSON into a flag with no interpretation. Keying on language was rejected: Python alone maps to Ruff, pylint, and flake8, which have different dialects. `--tool=anonymous` is refused so it cannot collide with the anonymous variant file.

**`route` paragraphs render at serve time from a scan.** `route` is served with a fresh `detect` scan, the same way `HOST_TOOLS` is, and gains one paragraph per detected linter that has a legacy recipe. A static table of every tool was rejected: it grows with every linter we add, and an agent in a Ruff repository gains nothing from reading about Biome. With `mechanics === false` (recipes served without a CLI), the slot renders the full table, because there is no repository to scan.

**The five-rule threshold is a `detect` count, not recipe prose.** The threshold decides whether an agent may write code into a linter, so it should be computed rather than judged. `detect` already reads the config files involved. Counting rules means:

- **ESLint:** rule files and rule folders in a house rule directory (`eslint-rules`, `eslint-local-rules`, `tools/eslint-rules`). Index files, tests, type declarations, and helper folders are not counted. A flat config that imports a plugin from a relative path or defines rules inline, and a local-rules loader package, are custom rules whose count cannot be read without executing JavaScript, so they are reported as evidence with an `"unknown"` count. A counted directory of five or more settles it either way. Otherwise unknown stays unknown, and the recipe treats it as below the threshold.
- **Biome:** the length of `plugins` across the root and nested configs.
- **pylint:** `load-plugins` entries that resolve to a module inside the repository.
- **flake8:** checkers under `[flake8:local-plugins]`.

**Discovery for Ruff and Biome is web-first, then confirmed locally.** Both tools ship too many rules to match a request against: `ruff rule --all --output-format json` returned 972 rules on 0.17.2. External testing found no reliable way for an agent to search that list for a request. The web finds the candidate. `ruff rule <name>` and `biome explain <rule>` confirm that it exists in the installed version and reveal preview status.

**The ESLint plugin list is curated and linked, and the recipe never lists individual rules.** Eight plugins, each with a summary and a docs link. This narrows the standing "no catalog" line instead of removing it, because a catalog of rules goes stale with every plugin release, while a list of plugins changes rarely.

**Vendor tests pin recipe claims against real installs.** Each claim a recipe makes about tool behavior gets a test that runs the tool, in the same spirit as the existing Vale and ast-grep vendor-contract tests: preview status in the `ruff rule` JSON, `--help-msg` failing without `--load-plugins`, `biome explain` output, and `banned-modules` in `flake8-tidy-imports --help`. They run through `uvx` and `pnpm dlx` at pinned versions, so a version bump that breaks a claim fails a test instead of shipping a wrong recipe.

## Research record

Measured on 2026-10-22 with Ruff 0.17.2, pylint 4.1.3, flake8 7.4.1, Biome 2.6.2, and ESLint 10.13.0 current on npm. Doc quotes were fetched from official pages the same day.

| Tool   | Claim                                                                                                                                                                                | Source                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Ruff   | Default set grew to 413 rules in 0.16.0, so `select` cannot be compared against `E4/E7/E9/F`                                                                                         | https://github.com/astral-sh/ruff/blob/main/changelogs/0.16.x.md                  |
| Ruff   | `banned-api` is TID251, configured under `flake8-tidy-imports`                                                                                                                       | https://docs.astral.sh/ruff/settings/ and `ruff rule TID251`                      |
| Ruff   | `unnecessary-regular-expression-compile` is preview-only and needs `--preview`                                                                                                       | `ruff rule unnecessary-regular-expression-compile`                                |
| Ruff   | No custom-rule API exists                                                                                                                                                            | no official page describes one                                                    |
| ESLint | v10 removed `.eslintrc*`; config lookup starts from each linted file                                                                                                                 | https://eslint.org/docs/latest/use/migrate-to-10.0.0                              |
| ESLint | Local and inline plugins are supported in flat config                                                                                                                                | https://eslint.org/docs/latest/use/configure/plugins                              |
| ESLint | `eslint-plugin-import` 2.32.0, `eslint-plugin-react` 7.37.5, `eslint-plugin-jsx-a11y` 6.10.2 declare `eslint` peers only up to 9. `eslint-plugin-import-x` 4.17.1 declares `^10.0.0` | `npm view <pkg> peerDependencies.eslint`                                          |
| Biome  | GritQL plugins since 2.0; JS plugins a developer preview since 2.6                                                                                                                   | https://biomejs.dev/linter/plugins/, https://biomejs.dev/blog/biome-v2-6/         |
| Biome  | `biome explain <rule>` prints a rule's documentation                                                                                                                                 | `biome explain noRestrictedImports` on 2.6.2                                      |
| pylint | `--list-msgs` lists 393 messages; `--help-msg=bad-builtin` fails without `--load-plugins=pylint.extensions.bad_builtin`                                                              | measured                                                                          |
| pylint | `load-plugins`, `deprecated-modules`, `preferred-modules`                                                                                                                            | https://pylint.readthedocs.io/en/stable/user_guide/configuration/all-options.html |
| flake8 | Reads only `setup.cfg`, `tox.ini`, `.flake8`; `[flake8:local-plugins]` since 3.5.0                                                                                                   | https://flake8.pycqa.org/en/latest/user/configuration.html                        |
| flake8 | No rule-listing command; `--bug-report` lists installed plugins                                                                                                                      | measured                                                                          |
| flake8 | `flake8-tidy-imports` provides `--banned-modules`                                                                                                                                    | `flake8 --help` with the plugin installed                                         |

Two claims are inferred, not quoted, and are not used in recipe text until verified: that flake8 has no native `pyproject.toml` support, and that `--rulesdir` is dead in ESLint 10.

## Risks / Trade-offs

- **A recipe claim drifts when a linter releases.** → The vendor tests pin each claim at a version. Bumping that version is a deliberate step that reruns them.
- **The repository runs an older linter than the recipe was measured against.** → Recipes state version boundaries where they matter (ESLint 9 against 10, Biome 1 against 2, Ruff before and after 0.16), and confirm discovery against the installed version.
- **The ESLint count is undercounted when config is computed.** → Unknown counts are treated as below the threshold, which sends the request to Taskless, the safe direction.
- **Web discovery is unavailable on the host.** → The recipe falls back to the local confirm command plus the catch-all rules, and says the search was skipped.
- **Recommending an `eslint-plugin-import` to an ESLint 10 repository installs with a peer warning.** → The recipe names `import-x` for that case and prefers whatever is already installed.

## Migration Plan

Recipe and additive JSON changes only. The `detect --json` schema gains a field, which existing readers ignore. Rollback is a revert of the recipe files. There is no state to migrate.
