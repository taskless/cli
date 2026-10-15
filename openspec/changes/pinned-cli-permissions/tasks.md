## 1. Releases pin their version (PR 1)

- [x] 1.1 Bake `npx @taskless/cli@<version>` as the prod define; add a build-target define and move `isProductionInvocation()` and its callers onto it
- [x] 1.2 Stop appending `@latest` in `pinnedSpecifier()`; update user-facing command composition
- [x] 1.3 Update the recovery-line and stub-staleness logic that treats the unpinned invocation as the released form
- [x] 1.4 Report stale pins in CI and hook files (the files `detect` recognizes) through the existing notice and `pinnedCli`; update the `init` recipe
- [x] 1.5 Tests: prod skill, recipes, and printed remedies name the pinned version; nightly and self unchanged; CI and hook pins
- [x] 1.6 Changeset; run `pnpm typecheck` and `pnpm lint`

## 2. Permission rules (PR 2)

- [x] 2.1 Hand test: under Claude Code auto mode, confirm `Bash(npx @taskless/cli-nightly@<pin> *)` in `.claude/settings.json` survives entry and lets `agent ok` run, in a trusted workspace
- [x] 2.2 Hand test Codex: `codex execpolicy check --rules .codex/rules/taskless.rules -- <inv> check` allows, and `<inv>1 check` does not
- [ ] 2.3 A writer per format: Claude Code, Cursor editor and CLI, OpenCode object (last) and array (first), JSONC-preserving, and Codex
- [ ] 2.4 Deny detection and unparseable-file refusal per format
- [ ] 2.5 `install.permissions` in the manifest; upgrade replacement; delete a Taskless-created file left empty
- [ ] 2.6 Report every edit: `Created`/`Edited <file>` with green `ALLOW:`, red `REMOVE:`, yellow `SKIPPED:` lines via `util/color.ts`; preview in the wizard summary step before writing; print after writing in `--no-interactive`; stderr plus envelope data under `--json`
- [ ] 2.7 Preflight wording: per-command approval only where a harness cannot scope a rule to one invocation
- [ ] 2.8 Tests per format: merge, placement, no longer-version match, deny, malformed, upgrade, user-owned rule untouched
- [ ] 2.9 Update the `init` recipe; changeset; run `pnpm typecheck` and `pnpm lint`
