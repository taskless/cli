---
"@taskless/cli": patch
---

The setup wizard's output reads as one block per step, and says plainly when the install is left uncommitted.

- A migration's summary, and the `Created` lines for the project launcher, continue under the step that opened them instead of each starting a new one.
- The telemetry notice is shown under a "Telemetry Information" heading, one sentence per line, and `init` prints the same lines. It, the README, and the `init` (topic v14) and `feedback-invite` (topic v5) recipes name `TASKLESS_TELEMETRY_DISABLED=1` and the `"telemetry": false` setting as the opt-outs. `DO_NOT_TRACK=1` still turns telemetry off; it is a cross-tool setting, so Taskless no longer advertises it as its own.
- Cancelling the commit question (Ctrl+C), declining it, or a commit git refuses now closes the wizard with "Taskless is installed, but its files are not committed yet." instead of "Taskless is ready to go.", which read as though the commit had happened.
