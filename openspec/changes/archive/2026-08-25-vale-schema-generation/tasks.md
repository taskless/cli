## 1. The probe, built to the method rule

- [x] 1.1 Run Vale with `--output=JSON` in an isolated temp config (`BasedOnStyles =`, `--no-exit`) and model one run's outcome as a closed set: `clean`, `diagnostic`, `panic`, `unrecognized`. No branch folds an unfamiliar shape into "fine".
- [x] 1.2 Parse the config-error object off **stderr** and key on `Code`. Confirmed the shape on 3.18.0: `{Line, Path, Text, Code: "E201", Span}`.
- [x] 1.3 Make `unrecognized` fatal at every call site, and detect panics explicitly rather than by the absence of a phrase.
- [x] 1.4 Resolve the binary through the shipped `findValeBinary`, and refuse to run if its self-reported version differs from `VALE_VERSION`.

## 2. Derive the self-enumerating vocabularies

- [x] 2.1 Read the check types out of `'extends' key must be one of [...]`. Twelve on 3.18.0.
- [x] 2.2 Read the levels out of `'level' must be one of [...]`. Three, left in the binary's own order because that order is severity.
- [x] 2.3 Throw rather than emit a short enum if either line stops matching, with a message saying why a truncated enum is the worse failure. Verified by hand against a deliberately broken pattern.

## 3. Derive the per-check field tables

- [x] 3.1 Hand-seed a minimal working base rule per check, and verify each runs clean before any verdict is taken against it. Several checks are not valid empty.
- [x] 3.2 Seed the candidate universe from four sources and document the provenance in the generator, including names the binary rejects.
- [x] 3.3 Cross-probe every check's fields against every other check, so the tables are a measured partition.
- [x] 3.4 Read membership from the outcome set: clean → member, `has invalid keys` naming the field → not a member, any other `E201` → member, panic → member. Record the last two as auditable inferences. Ten type complaints on 3.18.0 (all `action`), zero panics.
- [x] 3.5 Exclude the header keys from probing — they are members by construction, and `extends: true` panics.
- [x] 3.6 Detect the permissive checks with a sentinel key, and do **not** read a panic as evidence there. `consistency` and `spelling`.
- [x] 3.7 Derive the common fields as the intersection of the strict tables rather than declaring them.

## 4. Derive the scope operands

- [x] 4.1 Write a fixture per candidate carrying its construct, with the extension that routes it to the right parser.
- [x] 4.2 Run a `scope: raw` reach probe on every fixture and make an unreachable fixture fatal.
- [x] 4.3 Record the three-valued verdict per candidate, including negative controls (`fenced`, `banana`, `heading.h7`, `table.row`).
- [x] 4.4 Include an operand only if it fired; record `documented` per candidate so a disagreement can be stated.

## 5. Emit

- [x] 5.1 Write `src/generated/vale-vocabulary.ts` — check types, levels, permissive checks, common fields, per-check tables, scope operands, scope prefixes, divergences — with no timestamp, so the artifact is a pure function of the binary.
- [x] 5.2 Write `src/generated/vale-vocabulary-report.md`: what was derived versus seeded, the divergences, and every scope probed.
- [x] 5.3 Format both through the repository's own prettier, so a re-generation is a no-op diff.
- [x] 5.4 Add `pnpm generate:vale-schema`.
- [x] 5.5 Verify idempotence: deleted both artifacts, re-ran from clean, byte-identical.

## 6. Wire the schema to the artifact

- [x] 6.1 Replace the hand-maintained enums and field tables in `vale-rule.ts` with imports. Keep zod as the validation layer.
- [x] 6.2 Keep the scope grammar, the case-folding transform, the two-stage `.pipe()`, and the three fatal-shape checks exactly as they were.
- [x] 6.3 Assert the artifact's version against `VALE_VERSION` as a conditional type, so a mismatch is a build failure rather than a runtime throw. Verified by flipping the artifact's version and watching `tsc` fail naming the line.
- [x] 6.4 Guard the spelled-out union against the derived check types at import: every derived type present exactly once, and classified strict or permissive.

## 7. Prove it against the corpus

- [x] 7.1 All 86 existing corpus rows pass unmodified. No row edited to fit the output.
- [x] 7.2 Add rows for ground the generation newly measured: `comment.line` and `comment.block` in the TypeScript tier. 88 rows.
- [x] 7.3 Record the three earlier claims that did not reproduce — `figure.caption`, `comment.block`, and the `.ts` requirement — in design.md.
- [x] 7.4 `pnpm typecheck`, `pnpm lint`, `pnpm test` green.
- [x] 7.5 `pnpm build`, then verify the real CLI by hand on a broken rule.

## 8. Land

- [x] 8.1 One changeset on this branch.
- [x] 8.2 Archive the change — this is the tip of the stack.
- [x] 8.3 Open the PR against `openspec/vale-authoring-polish-schema`, referencing #171.
