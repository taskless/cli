## 1. Mechanism

- [x] 1.1 Add `src/prompts/sections.ts`: the on-demand marker, heading slugs, splitting at `## ` outside fences, the outline with its table of contents, one section under the preamble, and link rewriting
- [x] 1.2 Load recipes as source plus on-demand set in `recipes.ts`, and add `getServedRecipe` (outline, section, full) and `getServedRecipeText`
- [x] 1.3 Add `--section` and `--full` to `agent`, report an unknown section, and capture `section` on `cli_agent`
- [x] 1.4 Serve the outline from `onboard` and `update` as well

## 2. Recipes

- [x] 2.1 Restructure every recipe over budget so its outline and each section fit 8 KiB, moving reference material into sections on request and bumping each topic version
- [x] 2.2 Turn same-recipe cross-references into section links and cross-topic ones into `--section` citations
- [x] 2.3 Tell the skill to print a section a step names

## 3. Tests

- [x] 3.1 Unit tests for the section helpers
- [x] 3.2 Budget tests for every topic's outline and every section, and cross-reference tests for links and citations
- [x] 3.3 CLI tests for `--section`, an unknown section and a second positional; the prompts parity test uses `--full`
