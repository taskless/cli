## 1. One Taskless rule per project file

- [x] 1.1 Add `isTaskless(entry)` to each harness in `install/permissions.ts` (Claude both `*` and `:*` forms, Cursor editor, Cursor CLI, OpenCode object and array, Codex), matching only allow entries; verify with per-harness tests covering a pinned rule, an unversioned rule, a near-miss package (`@taskless/cli-foo`), another package, and a deny entry
- [x] 1.2 Change `syncPermissions` to remove every Taskless entry present in a managed file that is not a wanted rule, keeping the record only for `created`; verify the "unrecorded Taskless rule is replaced", "colon form", "other entries are untouched" and "pre-existing file is never deleted" scenarios as tests in `permissions.test.ts`
- [x] 1.3 Update the module comment and the `PermissionEdit.removed` doc comment, which still say unrecorded rules are never touched; verify by reading the diff
- [x] 1.4 Confirm the wizard preview and `--no-interactive` output list each unrecorded removal as `REMOVE:`; verify with a wizard summary test and an `init --no-interactive` test

## 2. Global trust entry

- [x] 2.1 Add the `GlobalTrust` interface, the `GLOBAL_TRUST` list with the Claude Code entry and its fixed text, and `syncGlobalTrust(home, selected, { write })`; verify with tests using a temporary home for: absent file, no `autoMode`, existing list with and without `$defaults`, a reworded `Taskless CLI:` entry treated as present, an unparseable file skipped, and comments preserved
- [x] 2.2 Assert that the entry text contains no digit sequence shaped like a real version except the fixed example, and begins with `Taskless CLI:`; verify with a unit test
- [x] 2.3 Ensure only selected harnesses in the table are read: verify a `.cursor/`-only install never touches the temporary home

## 3. Wizard and init

- [x] 3.1 Show the global edit in the wizard summary under its own heading naming the file as outside the project, with an `ALLOW:` line, and ask a separate confirm after the project confirm; verify with summary tests for offer, accept, and decline (decline leaves the file byte-identical and the install completes)
- [x] 3.2 Make `--no-interactive` and `--json` call `syncGlobalTrust` read-only only; verify with a test that the temporary home's settings file is byte-identical after `init --no-interactive`
- [x] 3.3 Print the missing-entry warning in both modes after the install, to stderr under `--json`, naming harness, file, key, and entry text; add the per-harness global trust outcome to the `init --json` envelope; verify with output and envelope tests, including silence when present
- [x] 3.4 Update `packages/cli/src/agent/init.md` with the envelope's new field; verify the prompt parity tests pass

## 4. Skill fallback

- [ ] 4.1 Rewrite the preflight section of `skills/taskless/SKILL.md` per the modified `skill-taskless` requirement: classifier refusal branch with the entry inline and the file and key named, no project rule offered for it, the agent never writing the entry, and no `agent <topic>` lookup; verify with new assertions in `installed-documentation.test.ts` and the 150-line cap test
- [ ] 4.2 Assert the skill body's entry text equals the `GLOBAL_TRUST` entry text, so the two cannot drift; verify with a test that imports both

## 5. Checks and release note

- [ ] 5.1 Add a `patch` changeset describing the stale-rule removal and the wizard's offer; verify `.changeset/` holds exactly one new file
- [ ] 5.2 Run `pnpm typecheck`, `pnpm lint`, and `pnpm --filter @taskless/cli test`; verify all pass
- [ ] 5.3 Run `pnpm openspec validate init-global-agent-trust --strict`, then the pre-archive scenario check from CLAUDE.md for `cli-init` and `skill-taskless`; verify every prior scenario survives, and that the removed requirement "The manifest records permission rules, and an upgrade replaces only those" is replaced by "Each permission file holds exactly one Taskless rule"
- [ ] 5.4 Manually, in a scratch repo under Claude Code auto mode with the entry in `~/.claude/settings.json`, run onboarding and record whether `info --json` is still refused; note the result in the PR body (a follow-up, not a merge gate)
