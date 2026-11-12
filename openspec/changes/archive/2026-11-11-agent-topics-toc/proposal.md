## Why

Several `agent <topic>` recipes are longer than an agent harness shows from one tool call (#672). `create-vale-rule` rendered at 68KB, `update` at 36KB, `report` at 25KB, `create-sg-rule` at 24KB and `route` at 21KB. Harnesses cut the middle out of long output, and one measured its limit at about 8.6k characters, so an agent lost the reference a step depended on, or re-fetched the recipe into a file and read it in pieces. In the CLI PMF agent survey about 11 of 40 onboarding runs reported it, and the part lost most often was `route`'s engine reach lists, which decide where a rule goes.

## What Changes

- A recipe's `## ` headings divide it into sections, each addressable by the slug of its heading. An author marks a section with `<!-- on-demand -->` on the line above its heading to serve it on request instead of in the topic's default output.
- `taskless agent <topic>` prints the topic's outline: every section not marked on demand, then a `## Sections on request` list naming the others and the command that prints one. A recipe with no on-demand section prints as before.
- `taskless agent <topic> --section <name>` prints one section beneath the recipe's header block and its one-command-per-call paragraph. An unknown name exits 1 and lists the topic's sections. `--full` prints the whole recipe.
- A cross-reference to another section of the same recipe is a markdown link (`[Quirks](#quirks)`). The full text keeps it as a link. The outline and a section rewrite a link to a section they do not print as the section's name.
- `taskless onboard` and `taskless update` serve the same outline as `agent onboard` and `agent update`.
- The long recipes are restructured: steps stay in the outline, and reference material (quirk tables, worked examples, input schemas, engine reach lists, ledger entries, templates) moves into sections served on request. Content moves; it is not dropped.
- A test holds every topic's outline, and every section on its own, to 8 KiB when rendered with a nightly's invocation, the feedback invite included for the surveyed topics. Another holds every section link and every `--section` citation to a section that exists.
- `cli_agent` carries a `section` property on a section fetch, so a funnel can tell a second look at a topic from a fresh fetch of it. A section fetch never carries the feedback invite.
- The skill tells the agent to print a section a step names before acting on that step.
- `@taskless/cli/prompts` is unchanged: it renders the whole recipe, markers removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-agent`: the agent subcommand gains `--section` and `--full`, and serves long topics as an outline with sections on request.

## Impact

- `packages/cli/src/prompts/sections.ts` (new), `src/prompts/recipes.ts`, `src/commands/agent.ts`, `src/commands/onboard.ts`, `src/commands/init.ts`, the recipes in `src/agent/`, and `skills/taskless/SKILL.md`.
- Delivery shape: **single PR**. The mechanism is small, and the recipe restructuring cannot land without it or be tested apart from the budget it is measured against. Most of the diff is recipe text moved between sections, so it runs well past the 1200-line guideline; it is one change and a split would leave a layer whose budget test is red.
