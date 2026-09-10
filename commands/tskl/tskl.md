---
name: "Taskless"
description: Run any Taskless action — create/improve/delete a rule, run check, manage auth, or wire CI. Routes via `agent <topic>` to fetch the canonical recipe and follow it.
category: Taskless
argument-hint: <describe what you want to do>
tags:
  - taskless
metadata:
  author: taskless
  commandName: tskl
---

# Taskless

The user invoked Taskless via `/tskl` with: $ARGUMENTS

If `$ARGUMENTS` is empty or ambiguous, ask the user what they want to do
with Taskless before proceeding.

Otherwise, follow the same flow as the `taskless` skill:

1. Identify the topic from `$ARGUMENTS` using the table below.
2. Fetch the canonical recipe with `%(TASKLESS_CLI)s agent <topic>` (or
   `%(TASKLESS_CLI)s agent <topic> --anonymous` if the user is offline or
   explicitly asked for anonymous mode).
3. Follow the recipe step-by-step. The recipe is canonical for the
   currently-installed CLI version; do not improvise from prior knowledge.
4. Fetch again next time. A recipe is resolved when it is fetched, from the
   installed version, the auth state, and the project layout at that moment.
   A copy fetched earlier in this session is not a substitute, even for the
   same topic.

## Topics

| User wants                 | Topic                                 |
| -------------------------- | ------------------------------------- |
| Update Taskless skills     | run `%(TASKLESS_CLI)s update`         |
| Create a new rule          | `%(TASKLESS_CLI)s agent route`        |
| Improve an existing rule   | `%(TASKLESS_CLI)s agent improve-rule` |
| Delete a rule              | `%(TASKLESS_CLI)s agent delete-rule`  |
| Check code against rules   | `%(TASKLESS_CLI)s agent check`        |
| Log in, log out, or status | `%(TASKLESS_CLI)s agent auth`         |
| Wire into CI               | `%(TASKLESS_CLI)s agent ci`           |

If unsure, run `%(TASKLESS_CLI)s agent` (no args) for the topic
disambiguation table.
