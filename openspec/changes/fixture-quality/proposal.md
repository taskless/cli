## Why

A user reviewed a rule an agent authored with Taskless. The rule was correct, but its fixtures were not code their team would accept. A `valid:` case used `Record<string, never>` and deeply nested call chains, and broke their own ESLint config. In their words, "the safer code fails while the bad code passes". People read fixtures as examples of the codebase's style, so fixtures like these lose the reader's trust before anyone looks at what the rule checks.

The recipes allow this. `create-sg-rule` asks for fixtures "drawn from real code where you can" and says nothing else about what a fixture should look like. None of the authoring recipes runs `detect` before writing fixtures, so none of them knows which linters the repository enforces.

## What Changes

- Every recipe in which the agent writes fixtures gets one shared fixture-quality passage. Those recipes are `create-sg-rule`, `create-vale-rule`, `create-runtime-rule`, and `improve-rule.anonymous`, which adds cases to an existing test file. The passage covers three things:
  - **Real code first.** Fixtures are copied from real code in the repository and trimmed down to the case. Invented snippets are only a fallback for when the repository has no instance, and the report says which cases were invented.
  - **Respect the repository's linters.** The agent reads `linters[]` from `taskless detect --json`, reuses that output if routing already produced it, and reads each detected linter's config. It writes `pass`/`valid` cases those linters would accept, and runs a linter on a fixture when the fixture is a complete file the linter can check on its own.
  - **A fixture differs only where the rule looks.** Apart from the thing the rule checks, both buckets are plain code in the repository's idiom. No placeholder types such as `Record<string, never>` or `any`, and no nesting a reviewer would send back. Near-misses stay near-misses along the rule's own axis.
- `create-remote-rule` and `improve-rule` (logged in) apply the same quality bar to the `successCases`/`failureCases` and references they send to the generator, because the generator works from those inputs.
- **Out of scope:** `verify` does not lint fixtures and does not fail a rule over fixture style. Changes to the service-side generator are also out of scope.

**Delivery shape: single PR.** This changes recipe prose, adds one shared block to `src/prompts/recipes.ts`, and adds the tests for that block. The whole change fits in one reviewable diff, and none of it is unsafe on its own.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-agent-authoring`: adds a requirement covering where fixtures come from, how the repository's linters constrain them, and the scope rule for what a fixture may vary. This is an ADDED requirement. No existing requirement is rewritten.

## Impact

- `packages/cli/src/agent/create-sg-rule.md`, `create-vale-rule.md`, `create-runtime-rule.md`, `improve-rule.anonymous.md`: the fixture steps pull in the shared passage.
- `packages/cli/src/agent/create-remote-rule.md`, `improve-rule.md`: the enrich and reference steps apply the same bar to what is submitted.
- `packages/cli/src/prompts/recipes.ts`: a new shared variable for the passage. With mechanics off, it falls back to the existing supplied-evidence wording.
- Recipe tests (`prompts.test.ts`, `recipe-cross-references.test.ts`) and a changeset. Recipes ship inside the CLI bundle, so this is a `patch` release note.
