## 1. detect reports CI systems and commit-hook tools

- [x] 1.1 Add `ci` and `hooks` (`{ name, evidence }[]`) to `DetectResult` in `packages/cli/src/detect/scan.ts`, matched at the scan root only
- [x] 1.2 Add both fields to the `detect` output schema
- [x] 1.3 Tests in `detect.test.ts`: each CI system and hook tool is reported with evidence, a sub-directory CI config is not, and both are empty arrays on a bare repository
- [x] 1.4 Update `detect.md` (topic v1 → v2) with the new fields

## 2. The hooks topic

- [x] 2.1 Write `packages/cli/src/agent/hooks.md` (topic v1)
- [x] 2.2 Add `hooks` to `INTERNAL_TOPICS` in `packages/cli/src/prompts/index.ts`
- [x] 2.3 Keep `hooks.md` clear of the hand-written-invocation guard in `recipe-cross-references.test.ts` without an allowlist entry
- [x] 2.4 Add a `hooks` row to the topic table in `skills/taskless/SKILL.md`
- [x] 2.5 Point the `ci` recipe at `detect --json`'s `ci` field and at `agent hooks` in See Also (topic v3 → v4)
- [x] 2.6 Name `agent hooks` in the `check` recipe's See Also (topic v6 → v7)

## 3. The onboard step

- [x] 3.1 Add the "decide when the rules run" step to `onboard.md` between materializing and marking complete, and require the mark-complete question to be asked alone (topic v4 → v5)
- [x] 3.2 Add `agent ci` and `agent hooks` to onboard's See Also
- [x] 3.3 Tests in `onboard.test.ts` for the step order, the decline path, the lone question, and See Also

## 4. Ship

- [x] 4.1 Add a patch changeset
- [x] 4.2 Run `pnpm typecheck`, `pnpm lint`, and the CLI test suite
- [x] 4.3 Run the pre-archive scenario check, then archive the change
