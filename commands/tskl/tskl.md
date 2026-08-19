---
name: "Taskless"
description: Run any Taskless action — create/improve/delete a rule, run check, manage auth, or wire CI. Routes via `npx @taskless/cli agent <topic>` to fetch the canonical recipe and follow it.
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
2. Fetch the canonical recipe with `npx @taskless/cli agent <topic>` (or
   `npx @taskless/cli agent <topic> --anonymous` if the user is offline or
   explicitly asked for anonymous mode).
3. Follow the recipe step-by-step. The recipe is canonical for the
   currently-installed CLI version; do not improvise from prior knowledge.

## Topics

| User wants                 | Topic                                  |
| -------------------------- | -------------------------------------- |
| Update Taskless skills     | run `npx @taskless/cli update`         |
| Create a new rule          | `npx @taskless/cli agent route`        |
| Improve an existing rule   | `npx @taskless/cli agent improve-rule` |
| Delete a rule              | `npx @taskless/cli agent delete-rule`  |
| Check code against rules   | `npx @taskless/cli agent check`        |
| Log in, log out, or status | `npx @taskless/cli agent auth`         |
| Wire into CI               | `npx @taskless/cli agent ci`           |

If unsure, run `npx @taskless/cli agent` (no args) for the topic
disambiguation table.
