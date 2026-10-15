---
"@taskless/cli": patch
---

New `taskless agent ok` topic: it prints one line confirming the CLI can run, through the invocation it was launched with, and does nothing else. The Taskless skill and the `/tskl` command now run it once per session before any other Taskless command, so a harness that blocks download-and-run commands (Claude Code's auto mode, for one) stops the agent before it starts work rather than partway through. On a blocked command the agent now names the exact command to the user, offers three ways forward (an allow rule for exactly that invocation, approval through the agent's permissions command such as `/permissions`, or approving every Taskless command by hand in chat), and never proposes an allow rule that wildcards the package name or version.
