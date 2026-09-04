## 1. Corpus shape (PR 1)

- [ ] 1.1 Add `ReferenceTests` to `src/rules/reference.ts`: a `grouping`
      discriminant, `files`, and an optional `cases` list.
- [ ] 1.2 Move `TASKLESS_DIRECTORY` into `src/rules/layout.ts` and have
      `rulesRoot` read it, so the corpus has one value to generate from. Leave
      the other literals alone.
- [ ] 1.3 Publish the top-level `layout` block from `ENGINE_LAYOUTS`, and give
      each entry its resolved `directory` and `ruleFile`.
- [ ] 1.4 Group `runtime` fixtures into case directories and `vale` fixtures into
      case documents, from the manifest's `testPaths`. `sg` publishes
      `grouping: "ast-grep-test"` and no cases.
- [ ] 1.5 Bump `REFERENCE_VERSION` to 2 and say in the docstring what changed.
- [ ] 1.6 Regenerate `assets/reference.json` (`pnpm --filter @taskless/cli reference`).
- [ ] 1.7 Extend `test/reference.test.ts`: every case path resolves into
      `tests.files`; every fixture file belongs to exactly one case where cases
      are published; `runtime`'s two-file case is carried as one case; `sg`
      publishes no cases; the version is 2.
- [ ] 1.8 Assert the published `layout` agrees with `ENGINE_LAYOUTS` and that
      each entry's `directory` is what `ruleDirectory` returns for it, so the
      block cannot drift from the table the CLI dispatches on.
- [ ] 1.9 Changeset (minor — a published contract changed shape).

## 2. Constraint ids on rejections (PR 2)

- [ ] 2.1 Introduce the internal `{ message, constraintId? }` error shape and
      thread it through the sg verify layers.
- [ ] 2.2 Attribute each of the seven `RULE_CONSTRAINTS` entries at the site
      that raises it. Leave everything else unattributed.
- [ ] 2.3 Add `violations` to `src/schemas/verify-test.ts` and project it at the
      JSON boundary, leaving `errors` unchanged.
- [ ] 2.4 Extend `test/constraints.test.ts` — it already builds a rule that
      violates each entry keyed on `id`, so assert the reported `constraintId`
      there rather than in a new file.
- [ ] 2.5 Assert an unattributable failure carries no violation, and that a
      passing rule reports none.
- [ ] 2.6 Extend the changeset from PR 1 rather than adding a second.

## 3. Published output schemas (PR 3)

- [ ] 3.1 Add `src/schemas/index.ts` as the entry, re-exporting the `verify`/
      `test` envelope, the sg and vale verify-output schemas, and the constraint
      type. Direct re-exports, no barrel of internals.
- [ ] 3.2 Wire it into `ENTRY_SOURCES` and `LIBRARY_ENTRIES` in `vite.config.ts`,
      and into `exports` and `files` in `package.json`. The build's export
      classification fails on an entry in neither list, so this is checked.
- [ ] 3.3 Confirm the graph reaches no host capability — the build asserts it, so
      this is running the build, not writing a test that re-derives it.
- [ ] 3.4 Extend the changeset.

## 4. Close out

- [ ] 4.1 `pnpm typecheck`, `pnpm lint`, `pnpm --filter @taskless/cli test`.
- [ ] 4.2 Reply on #263 with the shape as shipped, and the two things
      deliberately not done (sg snippets, per-error ids beyond the seven, and
      any exported `verify()`/`test()`).
- [ ] 4.3 Archive on the tip PR.
