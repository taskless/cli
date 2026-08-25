## 1. Measure the binary before writing anything down

- [x] 1.1 Enumerate the check types the vendored Vale accepts, and resolve the docs' eleven against the MCP guide's twelve. Record the measured list and how it was obtained.
- [x] 1.2 Enumerate the accepted `scope` operands, including the hierarchical forms, the v3.17.0+ inline scopes, and the v3.18.0+ `meta` scopes. Confirm `~` negation and `&` chaining parse. **There is no `meta` scope**: the v3.18.0 addition is `frontmatter`/`frontmatter.<key>`, which is what fires. Negation over an unrecognized operand is a silent no-op. See design.md → Measured against Vale 3.18.0.
- [x] 1.3 For each check type, measure which fields it accepts and which it rejects with `E201`. This is the per-check table the schema encodes.
- [x] 1.4 Confirm the failure modes the design asserts still hold on the pinned binary: `extends: nonsense` and `scope: fenced` verify clean and match nothing; a foreign field throws `E201` and suppresses every other Vale rule's findings. **One half did not hold.** `extends: nonsense` is rejected outright on 3.18.0 — exit 2, whole run suppressed, same blast radius as `E201`. `scope: fenced` is the only genuinely silent case. Corrected in design.md.

## 2. Recipe gaps (unit 1, lands alone)

- [x] 2.1 Add the measured scope table to `create-vale-rule`, and state that `raw` subsumes `code` and `text`.
- [x] 2.2 State that `scope` is per-rule and that rules do not interact, despite the single assembled config.
- [x] 2.3 State that a `raw`-scoped rule cannot be suppressed by `<!-- vale Rule = NO -->`, and that a rule about a command needs `raw`.
- [x] 2.4 Add `nonword: true` for punctuation-only tokens, with the em-dash rule as the worked case.
- [x] 2.5 Document scoping a rule _out_ with a second matcher assigning `NO`.
- [x] 2.6 Add the collocation guidance: narrow a banned word to a collocation, and write the `pass/` fixture from the literal sense first.
- [x] 2.7 Add the fixture rule for a subject that appears in code: `fail/` must carry it inline, fenced, and in prose.
- [x] 2.8 Add `limit` and `vocab` to the common-fields table, and note that Vale requires `.yml` rather than `.yaml`.
- [x] 2.9 State that fixtures run under an isolating config, so passing tests do not prove the matcher reaches any real file.
- [x] 2.10 Update the recipe's cross-reference tests if the added sections change what they assert. No change needed: `recipe-cross-references.test.ts` asserts the rendered format lists, which the new sections do not touch, and the full suite is green.
- [x] 2.11 Write the changeset on this branch, so the stack inherits it.

## 3. The schema (unit 2)

- [ ] 3.1 Author the schema from the measurements in group 1, alongside `packages/cli/src/generated/ast-grep-rule-schema.json`. Pin it to `VALE_VERSION`.
- [ ] 3.2 Model the common header fields: `extends`, `message`, `level`, `scope`, `link`, `limit`, `vocab`.
- [ ] 3.3 Model `scope` as a grammar over an enum of operands, accepting a string, a list, `~`, and `&`.
- [ ] 3.4 Model the per-check field tables, so a field belonging to another check type is rejected before `E201` can suppress the engine.
- [ ] 3.5 Decide and record how strictly to treat a value whose status the measurements left unclear. The design's rule is to accept it.

## 4. Wire it into verify

- [ ] 4.1 Add the schema layer to the Vale verify path, reporting through the existing `LayerResult` and `VerifyResult` shapes so both engines fail the same way.
- [ ] 4.2 Ensure the error names the field and the accepted values, rather than reporting a raw schema path.
- [ ] 4.3 Confirm the layer runs before Vale is invoked, so a rule that would throw `E201` never reaches the binary.
- [ ] 4.4 Confirm `test` still runs `verify` first and stops on its failure.

## 5. The corpus, and the differential test that makes the schema true

Build this before the schema is finalized — the schema is derived from it. This is the largest group and the one that will be under-built if rushed.

- [ ] 5.1 Design the corpus entry shape: a minimal rule YAML, the fixture that acts as its positive control, and the measured verdict. Keep it a declarative table so a Vale upgrade is a re-run rather than a re-authoring.
- [ ] 5.2 Establish the three-outcome verdict, since an exit code cannot express it: **fired** (accepted), **did not fire** (the binary ignored the construct), **`E201`** (rejected outright). An unrecognized `extends` or `scope` parses clean, so "did not fire" is the signal that the construct is invalid.
- [ ] 5.3 Write a positive control per entry. It depends on what the rule matches — a `scope: heading` entry needs a heading, `scope: table.cell` needs a table — so it cannot be generated from the check type. This is the bulk of the work.
- [ ] 5.4 Guard against a vacuous entry: assert each control fires for at least one known-valid variant, so a control that can never fire is a test failure rather than a quiet pass.
- [ ] 5.5 Cover every check type from 1.1, every scope operand from 1.2, and the per-check field tables from 1.3, including the `~` and `&` forms.
- [ ] 5.6 Write the differential test: for every entry, assert `schemaAccepts === binaryAccepts`. Report both directions distinctly — schema-too-lax is the gap being closed, schema-too-strict blocks valid work and is the worse failure.
- [ ] 5.7 Wire the corpus into `packages/cli/test/vale-vendor-contract.test.ts`, or a sibling beside it, following the existing convention of invoking the vendored binary directly rather than through `runVale`.
- [ ] 5.8 Add the version-bump case: raising `VALE_VERSION` past a change in accepted check types or scopes fails a test that names the field.
- [ ] 5.9 Verify the suite is non-vacuous by reverting the schema and watching exactly the expected entries fail.

## 6. Regression coverage

- [ ] 6.1 Test that `extends: nonsense` fails `verify`, naming the field and the accepted values.
- [ ] 6.2 Test that an unrecognized `scope` fails `verify`, and that `~` and `&` over recognized operands pass.
- [ ] 6.3 Test that a foreign field for the declared check type fails `verify`.
- [ ] 6.4 Test that every rule under `.taskless/rules/vale/` still verifies, so no valid rule regressed.
- [ ] 6.5 Test that a rule with no fixtures still verifies, preserving the existing requirement.

## 7. Land it

- [ ] 7.1 `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
- [ ] 7.2 `pnpm build`, then author a deliberately-broken rule and confirm the real CLI reports what the specs require. Record the actual output.
- [ ] 7.3 Extend the changeset on the bottom branch with unit 2's scope.
- [ ] 7.4 Open the stack as two PRs merging forward, the recipe unit first.
- [ ] 7.5 Archive the change on the tip PR.
