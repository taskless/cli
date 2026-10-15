## Context

The `taskless` skill is a router: every action starts by running `%(TASKLESS_CLI)s agent <topic>`, which on a release is `npx @taskless/cli …` and on a nightly `npx @taskless/cli-nightly@<pin> …`. Harnesses increasingly gate download-and-run commands. Claude Code's auto mode classifier blocked one in a real session, and its docs say a block can be cleared by a user message that names the exact action, or by a narrow `permissions.allow` rule. Broad rules (blanket `Bash(*)`, wildcarded interpreters, package-manager run commands) are dropped on entering auto mode.

The session that hit the block had a vague request ("let's use taskless"), ran two read-only commands, then hit the block on `agent onboard`. Onboard's consent question was never reached, because it is in the recipe.

## Goals / Non-Goals

**Goals:**

- An agent learns whether it may run the CLI before it starts any task, at the cost of one trivial command.
- When it may not, the agent asks once, names the exact command, and suggests only remedies scoped to that command.

**Non-Goals:**

- Writing harness permission files (`.claude/settings.json` and others) from the installer. Whether a pinned `npx` allow rule survives auto mode is undocumented; that is tested by hand first.
- Changing onboard's own consent question.

## Decisions

**`ok` is built into `agent`, not a `.md` recipe.** A recipe must carry the `# Topic:` header, Goal/Preconditions/Steps/Errors/See Also, and the served copy gains the fetch-time directive ("fetch again next task"). All of that is noise around one line, and the directive is wrong here: a confirmation is not a recipe to refetch. The branch sits before recipe lookup in `agent.ts`, and the index lists it beside the commands. Alternative considered: a minimal `ok.md` exempted from the template requirement. Rejected, since an exemption in the format test is a second rule to maintain for one line.

**The line names the detected invocation, via `detectCliInvocation`.** That is the value recipes are rendered with, so the preflight and every later recipe agree on spelling. When it returns `undefined` the line says "via the command you just ran" instead of falling back to `npx` the way `getCliPrefix` does, because a guessed launcher in text an agent copies is worse than none.

**No project side effects.** `ok` does not bootstrap `.taskless/`, read the manifest, or check auth. It must be safe to run in any directory, first, and a preflight that writes project files would be one an agent cannot run speculatively. It does emit `cli_agent` with `topic: "ok"`, like every other topic: preflight volume against task volume is the measurement for how often agents stop at the gate. That capture carries telemetry's usual costs, which this change does not alter: unless telemetry is disabled, it writes the anonymous ID under the user's config directory and runs a `git` subprocess for repository context. Making `ok` skip telemetry entirely would lose the measurement, so it is left as every other topic has it.

**The remedies are scoped to the exact invocation.** The skill names three: the user approves the exact command in their reply (Claude Code reads an approval that names the specific action as clearing the block), the user runs `! <command>`, or an allow rule for exactly `%(TASKLESS_CLI)s`. It forbids widening the rule, because the agent in the incident improvised `npx @taskless/cli-nightly:*`, which approves every future nightly rather than the one installed, and which auto mode may drop anyway.

**Once per session, not per task.** Permission does not change between tasks in a session; recipes do. The skill's existing "fetch the recipe for every task" rule is unchanged.

## Risks / Trade-offs

- [The classifier allows `agent ok` but blocks a later command] → An approval or classifier judgement can be per-action. The skill's blocked-command guidance is written for any Taskless command, not only the preflight, so a later block gets the same handling.
- [The download block cannot be cleared by chat approval at all] → Then the `!` route and the allow rule remain. The manual auto-mode test decides whether the skill should lead with one of those instead.
- [One more command before every session's first task] → It is cached by npx after the first run and prints one line; the first-run latency note in the skill already covers the cold fetch.
