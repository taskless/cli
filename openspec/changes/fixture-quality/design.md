## Context

See proposal.md, under Why, for the motivation. This section covers only what shapes the approach.

- The authoring recipes are markdown files under `packages/cli/src/agent/`. They are rendered by `src/prompts/recipes.ts` through sprintf variables and embedded into the bundle at build time. `buildVariables` provides every variable on every render, and `prompts.test.ts` pins the full list of variable names.
- Fixture guidance today is per engine and lives in each recipe's own fixture step:
  - `create-sg-rule`: step 6, "Write the tests". Step 2 already says "search the codebase for real instances".
  - `create-vale-rule`: step 5, "Write the fixtures", which has detailed near-miss guidance for `pass/`.
  - `create-runtime-rule`: the "Testing a rule you wrote yourself" section, with directory-shaped cases.
  - `improve-rule.anonymous`: step 5, "Update test cases".
  - `create-remote-rule` (step 4, "Enrich it") and `improve-rule` (step 5, "Collect supporting references") write no fixtures. They submit cases to the generator. Step 4 already says "Real matches beat invented ones" and reads linter configs, but only to find exclusion patterns.
- `detect --json` already returns `linters[]`, each with a `name` and `evidence` (the config paths). `route` runs detection as its step 1 through `%(DETECT_EVIDENCE)s`. That block has a mechanics-off form for callers that supply the evidence themselves.

## Goals / Non-Goals

**Goals:**

- Write the fixture-quality guidance once and render it into every recipe that writes fixtures, so the recipes cannot drift apart.
- Keep each recipe's engine-specific fixture guidance where it is (Vale near-misses, ast-grep arity and awaited-call cases, runtime case directories). The shared passage adds to that guidance and replaces none of it.

**Non-Goals:**

- Any change to `verify`, `validate`, or the fixture file formats.
- The service-side generator's own fixture prompts. Whether it copies submitted `successCases` into fixtures word for word is the generator team's question.
- New `detect` output. `linters[]` already carries the evidence that is needed.

## Decisions

### One shared variable, `%(FIXTURE_SOURCES)s`, rendered as a whole block

The passage is a new `buildVariables` entry, rendered with `indentBlock` like `NAME_DESTINATION`, and dropped into each fixture step as a sub-paragraph.

- Alternative: copy the paragraph into four recipes. Rejected. Four copies pass the three-copy threshold for factoring out, and the copies would drift the first time one recipe's fixture step is revised.
- Alternative: a separate `agent fixtures` topic that each recipe tells the agent to fetch. Rejected. It costs an extra fetch at exactly the step where an agent is most likely to skip it, and the guidance is short enough to carry inline.

The block holds only what is engine-agnostic: the source order, the linter read, and the rule about varying only on the rule's axis. Each recipe keeps the word for its buckets (`valid`/`invalid` or `pass`/`fail`). For that reason the passage says "the passing bucket", not a key name.

### Detection reuses `DETECT_EVIDENCE`'s two modes

With mechanics on, the passage tells the agent to reuse `detect --json` output from routing if it has it, and otherwise to run it. With mechanics off, it uses the supplied-evidence wording, the same split `DETECT_EVIDENCE` makes, so a caller without the binary is never told to run it. Reusing earlier output matters because the common path is `route` → `create-*-rule` in one task, and running detection twice adds nothing.

### "Would accept", with running the linter conditional

The passage asks the agent to read each detected linter's config and write passing fixtures the linter would accept. It asks for an actual linter run only when a fixture is a complete file the linter can check on its own, which covers runtime case directories and whole Vale documents.

- Alternative: always run the linter on every snippet. Rejected. An ast-grep `valid:` entry is usually a fragment. Linting a fragment produces unused-variable and unresolved-import errors that have nothing to do with style, and an agent fixing those would pad the fixture with scaffolding that hides the case. That is the readability problem this change is trying to fix.

### Submitting recipes get a short pointer, not the block

`create-remote-rule` and `improve-rule` get one added bullet in their enrich and reference steps: submitted cases follow the same sourcing and idiom bar, and passing cases should be ones the detected linters would accept. They do not get the full block, whose step about writing fixture files does not apply to them. One short bullet in each of two places stays under the three-copy threshold.

## Risks / Trade-offs

- [The block's indentation differs between recipes] → `indentBlock` takes one indent. All four fixture steps sit inside a numbered list at three spaces, except the runtime section. The implementation checks each placement in the rendered output and gives the runtime recipe its own placement if it needs one.
- [The recipe parity tests compare rendered output against source] → Changing recipe text needs no test updates beyond the variable list, but running prettier over `src/` rewrites recipe markdown. Format only the files changed, by path.
- [An agent ignores the guidance anyway] → This is a recipe change with no gate behind it, by decision. Before archiving, check an authored rule by hand against a repository with ESLint, ideally the user's metric-counter rule.
- [The Vale near-miss guidance and "idiomatic" seem to pull in different directions] → They don't. A near-miss is idiomatic prose that varies on the rule's axis. The passage says so explicitly, so an agent does not read "idiomatic" as "correct prose, which proves nothing".

## Open Questions

- Could the user's actual rule and fixture file serve as a before/after example in the change's verification? This doesn't affect the approach.
