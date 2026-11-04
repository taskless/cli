## Context

`environmentStatusBlock` renders one instruction for every step: give them to the user. A stub-based `upgrade` command that an agent could run was drafted first and dropped. It would have let an allowed path run newly published code with nobody in the loop, and `npx <package>@<version> init` already moves the pin, repairs a broken one, and rewrites the launcher.

## Decisions

**The split follows what each step runs.** The cli and skill steps change what the project runs or what its harnesses read, so they stay the user's. `update` runs the recorded version and fetches nothing new. The rules recipe can rewrite rules, which is the kind of change an agent already makes and a person reviews in the diff.

**The rules step is the agent's on any invocation, not only a launcher run.** The agent just ran `agent ok` through that same invocation, so the harness that allowed it will normally allow `update`. A refusal falls back to the user.

**A rules step beside an upgrade waits.** The confirming `agent ok` reports what is owed after the move, which may be different. The agent never runs the step the first report listed.

**`npx` on a launcher run.** The launcher cannot reveal how the CLI was first installed, and `npx` is the documented upgrade spelling. Printing the agent-fill marker asked the agent to fill in a command it is not going to run.

## Risks / Trade-offs

- [A user declines the upgrade while the rules are owed on this CLI] → Declining is fine, and the passage says what follows. The upgrade stays listed, and the agent applies the rules step to the current CLI, because `check` and `verify` refuse until it is recorded.
- [The rules recipe can rewrite rules with no one watching] → That is what the agent already does when a person hands it the step, and the result is a reviewable diff.
