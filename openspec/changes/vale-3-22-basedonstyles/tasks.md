## 1. Measure

- [x] 1.1 Run the two-rule assembled layout (`StylesPath = rules/vale`, breadcrumbs, id order) against the 3.21.0 and 3.22.0 binaries: identical globs, `[*.md]` beside `[*.{md,markdown}]`, `[*.md]` beside `[docs/**]` in both id orders, neither rule writing the key, a single rule's later matcher carrying only the key, a `NO` matcher carrying the key, `UNSET` as a rule value and at the style level. Record which rule fires on which file for each.
- [x] 1.2 Measure whether any bundled style fires with no `BasedOnStyles` line, on both binaries, with a control that names `Vale` to prove the bait.
- [x] 1.3 Measure the rest of the release against both binaries: negated inline scopes and the release note's dotted spellings, `[formats]` by file name and glob against a fenced-block discriminator, front-matter placement with a token twice in one field, a rule `.yml` as a lint target with bait in every field, a notebook, MDX with a one-line element, `split: true`. Re-time the timeout fixtures.

## 2. Schema and constraints

- [x] 2.1 `schemas/vale-config.ts`: reject `BasedOnStyles` with any value under `vale-config-no-based-on-styles`; message for the empty form says what 3.22.0 does with it and to delete the line. Drop the "an empty BasedOnStyles" allowance from the own-key message and the ordering comment.
- [x] 2.2 `rules/constraints.ts`: rename the entry, rewrite summary and rationale from the measurement; adjust the two neighbouring rationales that named the empty key. Regenerate `assets/reference.json`.
- [x] 2.3 Fixture set: strip the line from every `test/fixtures/vale-config/*.ini` but the rejection fixture; add `based-on-styles-named.ini`; fix the shifted line numbers in `vale-config-schema.test.ts`; add the `[formats]` rejection test. Update `constraints.test.ts`.

## 3. Migration

- [x] 3.1 Add `filesystem/migrations/0008-drop-based-on-styles.ts` (line edit, anchored on the key, idempotent, skips untouched files and a missing tree) and register `"8"` in `migrate.ts`.
- [x] 3.2 `test/migrate-drop-based-on-styles.test.ts`: three matchers with three value shapes, byte-exact result, schema accepts the result, untouched file keeps its mtime, comment survives, idempotent, CRLF and no trailing newline, no rules tree, runner from version 7. Fix the 0007 test that pinned `version` to 7.
- [x] 3.3 Migrate this repository's own `.taskless/` with `pnpm cli init` after `pnpm build`, and commit the rewritten configs and manifest.

## 4. Isolating configs, fixtures, recipe, ledger

- [x] 4.1 Drop `BasedOnStyles =` from `buildIsolatingConfig`, the generator's `probe()` and `runOne`; replace the three docblocks' claim with the measurement from 1.2; flip the `vale-verify.test.ts` assertion.
- [x] 4.2 Drop the line from `assets/demo-vale/.vale.ini`, `example/`, the mixed-engines fixture project and every inline config in the test suite.
- [x] 4.3 `agent/create-vale-rule.md`: template is three lines, a paragraph on why the key is rejected, a paragraph on inline-element negation and the release note's dotted spellings; topic v11. `agent/update.md`: extend "Migrating to 0.11.3" with the migration, the negation change, and the additions; topic v9.

## 5. Version, vocabulary, contract

- [x] 5.1 `VALE_VERSION` to 3.22.0; `reconcile-marker.test.ts`; regenerate the vocabulary; add the bump paragraph to the tier table's docblock after checking the upstream tree for a learned format (none).
- [x] 5.2 `vale-vendor-contract.test.ts`: a `Vale 3.22.0` block pinning everything from 1.1 through 1.3 on the assembled layout. Corpus rows for `~link`, `~strong & ~emphasis`, `text.raw`, `paragraph.link`. Timing note in `vale-run.test.ts`.
- [x] 5.3 Grow `.changeset/vale-3-22-0.md` in place: what you can now write, what changes for a rule you already have, what did not change.

## 6. Land

- [x] 6.1 `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @taskless/cli test`, `pnpm openspec validate --all`.
- [x] 6.2 Dry-run the archive: wip commit, `pnpm openspec archive vale-3-22-basedonstyles -y`, count scenarios in the three specs before and after, reset to the wip SHA.
- [x] 6.3 Archive for real on this PR, since it is the single PR of the change.
