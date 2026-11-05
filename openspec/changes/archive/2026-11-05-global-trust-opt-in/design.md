## Context

`agent-global-trust` puts project and global settings edits under one confirmation. Answering no cancels the install, so the global edit is effectively required for anyone who wants Taskless through the wizard. The launcher, its lockfile and the recorded version already exist; this change is about consent, not mechanism.

## Goals / Non-Goals

**Goals:**

- A person can install Taskless and decline the edit outside the project.
- The person can tell what they are agreeing to, and why, from the prompt alone.

**Non-Goals:**

- Remembering a decline. The wizard runs only when a person starts it, so asking again is cheap, and a project manifest has no business recording personal state.
- Changing the entry's text, which would mark every existing entry stale.
- Writing from `init --no-interactive`, which stays read-only outside the project.

## Decisions

**Ask after the summary, before any write.** Every write stays behind every question, so cancelling at any step leaves everything as it was. Declining the summary ends the wizard without reaching this question.

**Default to no.** Enter is the one key that takes no reading, so it should not change a global file. A person who skips by accident gets approval prompts, which the next wizard run offers to fix.

**Show the exact entry.** It is prose an AI classifier reads, so a paraphrase would leave out what is actually being granted.

**Say that the entry reaches every project.** A user-level entry follows the launcher's path, not this repository, and a manual probe on 2026-10-19 found that an allowance covering the path also passed a launcher swapped to run another package. A prompt that explained only the pin would overstate the protection, so the step says this plainly.

**A decline is a statement, not a skip.** The red `SKIPPED (global):` block means an edit the user still owes. After a deliberate no, it would argue with the answer, so the wizard prints one line naming the cost and how to be offered it again. A file that could not be edited still warns, since that was not the person's choice.

## Risks / Trade-offs

- Fewer people will end up with the entry, so more will see approval prompts in auto mode. → Accepted: a repeated prompt costs a keystroke, and the prompt offers the fix on the next run.
- The explanation is long for a terminal prompt. → It appears only when the entry is absent or stale, and it is the only edit outside the project.
