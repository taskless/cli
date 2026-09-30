## 1. Policy

- [x] 1.1 `verdicts.ts`: read `copyOf` from each `unknown` entry (absent/`null`
      → none; unreadable → unaccounted, fail closed)
- [x] 1.2 Static copy: not run, removed from the snapshot, one failure naming
      the source and the differing files
- [x] 1.3 Rename: when the source is answered `missing`, one message naming
      `rule restore <source>`, and no separate `missing` notice
- [x] 1.4 Runtime copy: not executed, source named in the skip reason; a
      runtime rename is one notice and does not fail
- [x] 1.5 `integrity`: `copyOf: { ruleId, revisionId?, sourceMissing }` on the
      `unknown` entry, diff in `files`; `--json` schema in `schemas/check.ts`
- [x] 1.6 `plan-check.ts`: `engine.log` line per copy

## 2. Tests

- [x] 2.1 `verdicts.test.ts`: copy alone, copy + missing source (rename), a
      missing rule no copy names, runtime copy, runtime rename, `copyOf: null`,
      malformed `copyOf` for sg and runtime
- [x] 2.2 `runtime-check.test.ts`: end-to-end rename against the mock v2
      reconcile, including `engine.log`

## 3. Docs and release note

- [x] 3.1 `agent/check.md` and `agent/recover-rule.md` (no topic bump: both
      are new or bumped since v0.11.2)
- [x] 3.2 One sentence in `.changeset/cli-v2-rule-api.md`
- [x] 3.3 Spec deltas; dry-run the archive and confirm every standing scenario
      survives

## 4. Checks

- [x] 4.1 `pnpm typecheck`, `pnpm lint`, `pnpm --filter @taskless/cli test`,
      `pnpm openspec validate --all --strict`
