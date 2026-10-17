## 1. Entry text and stale detection

- [x] 1.1 Widen `GLOBAL_TRUST_ENTRY` in `packages/cli/src/install/global-trust.ts` with the shell-plumbing sentence; verify `global-trust.test.ts` asserts the sentence and that the text still names no version
- [x] 1.2 Add the `stale` state: `inspect()` returns it for the first labelled string whose text differs, with the edited text replacing that index; `syncGlobalTrust({ write: true })` writes for `absent` and `stale`; verify tests for current/stale/unlabelled, in-place replacement preserving order and other entries, and duplicates beyond the first left alone
- [x] 1.3 `describeGlobalTrust()` returns a line for `stale` entries marked as a replacement, and `globalTrustWarnings()` warns for `stale` saying the existing entry is out of date; verify with unit tests

## 2. Wizard and init

- [ ] 2.1 Summary shows `REPLACE (global):` for a stale entry and counts it as a settings edit; the wizard writes on confirm for `absent` or `stale`; verify `wizard-integration.test.ts` covers replace-on-confirm and byte-identical on decline
- [ ] 2.2 `init` reports `stale` in `--json` and warns, never writing; update `packages/cli/src/agent/init.md` state list; verify `init-no-interactive.test.ts` asserts the stale state and an unchanged user file

## 3. Skill body

- [ ] 3.1 Add the standalone-command rule to `skills/taskless/SKILL.md`, and rewrite the classifier fallback for a present entry, the rerun-once-on-its-own exception, and replacing an older labelled entry, with the new entry text inline; verify `installed-documentation.test.ts` (entry text parity) and the skill body cap test pass
- [ ] 3.2 Add skill-body tests for the new scenarios (standalone rule, present entry not asked for again, combined command rerun once); verify they pass

## 4. Release

- [ ] 4.1 Add a `patch` changeset describing the entry refresh and the standalone rule; run `pnpm typecheck`, `pnpm lint`, and `pnpm --filter @taskless/cli test`, all passing
- [ ] 4.2 Run the pre-archive scenario check from CLAUDE.md, then archive the change on the PR
