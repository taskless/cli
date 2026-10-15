## 1. The `ok` topic

- [x] 1.1 Add the `ok` branch to `packages/cli/src/commands/agent.ts`, before recipe lookup: print the confirmation line from `detectCliInvocation`, with the "command you just ran" fallback, and capture `cli_agent` with `topic: "ok"`
- [x] 1.2 List `ok` in the `taskless agent` index
- [x] 1.3 Tests: one-line output and exit 0, detected and unknown launcher, no `.taskless/` created, index row, telemetry topic

## 2. Skill and command bodies

- [x] 2.1 Add the preflight section to `skills/taskless/SKILL.md`: run `%(TASKLESS_CLI)s agent ok` once per session first; on a block, stop, name the exact command, offer chat approval, `!`, or an exact-invocation allow rule, and forbid widening it. Keep the body within 150 lines
- [x] 2.2 Add the same step to `commands/tskl/tskl.md`
- [x] 2.3 Tests asserting both bodies carry the preflight and the blocked-preflight guidance

## 3. Release

- [ ] 3.1 Add a `patch` changeset
- [ ] 3.2 Run `pnpm typecheck` and `pnpm lint`
- [ ] 3.3 Manual: in a scratch repo under Claude Code auto mode, check whether the preflight is blocked, whether an exact-command approval in chat clears it, and whether a pinned allow rule survives auto mode; record the results in the PR
