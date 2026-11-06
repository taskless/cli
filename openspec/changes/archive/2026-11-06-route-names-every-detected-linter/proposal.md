## Why

`route` prints "The linters `detect` found here" and then lists only linters with a guide paragraph, so a repository running Oxlint and ESLint reads as ESLint-only. In a repository running only Oxlint, `route` says steps 1 and 2 of the legacy ladder do not apply, which contradicts the requirement that step 1 is taken whenever a detected linter could host the rule. Found on NoMercyLabs/nomnomzbot, where `detect` reports Oxlint correctly and `route` omits it.

## What Changes

- Add an Oxlint recipe, `create-legacy-rule --tool=oxlint`, and a paragraph for it in `route`.
- `route` names every detected tool that can host a rule. One with no paragraph is listed with the fetch command for the generic recipe, and the ladder still applies to it.
- Formatters and Taskless's own engines stay out of that list.
- A scanned `route` says `detect` recognizes a fixed list of tools, so the repository may run others.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-rule-routing`: `route` no longer implies a detected linter is absent.
- `cli-legacy-rule-recipes`: Oxlint joins the per-tool recipes.

## Impact

- `packages/cli/src/prompts/recipes.ts`, `src/agent/route.md` (topic v9), and the new `src/agent/create-legacy-rule.oxlint.md`.
- The custom-rule count from a repository root, and C# language detection, are separate work.
- Delivery shape: **single PR**. The recipe and the routing that points at it fit one review.
