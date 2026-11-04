## Context

No code in the CLI asks which harness started it. A wrong answer here costs little: the output is a suggestion, and another terminal is always offered.

## Decisions

**Vendor variables from a fixed table, for wording only.** Variables are not a shared standard: `AI_AGENT` is an open proposal, and its values differ by product. So each row names a variable that product sets and a prefix it documents, and nothing from the environment reaches the output. Any process can set these, so they never decide what is allowed.

**Only harnesses Taskless installs for, and only documented syntax.** Crush installs but documents no such prefix, so it gets a terminal. Copilot CLI, Aider, and Amp have prefixes and are not in the installer.

**`!` only on Claude Code's CLI entrypoint.** The VS Code extension sets `CLAUDECODE` and has no `!` shortcut, so `CLAUDE_CODE_ENTRYPOINT` narrows it.

**Cursor states its limit.** `/shell` stops at 30 seconds and takes no prompts, and a first `npx` of a version can take longer, so the passage names another terminal for that case.

## Risks / Trade-offs

- [`CURSOR_AGENT` was reported unset by Cursor's CLI in 2025, and `CODEX_THREAD_ID` is undocumented] → A miss falls back to another terminal, which works.
- [Harness variables are inherited, so a nested agent can read as its parent] → The prefix may name the outer harness. Another terminal is still offered.
- [Prefixes change] → Each row cites its source, and a stale row costs one wrong suggestion.
