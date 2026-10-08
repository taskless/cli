# Topic: bug-report     (CLI v%(CLI_VERSION)s / topic v1)

## You are here
This is `bug-report`. It helps you report a bug in Taskless to the
Taskless team on the user's behalf, without a GitHub account: the CLI
or a recipe did something wrong, failed, or produced a result that does
not match what it promised. The user started this; no invite did.
For an opinion or a wish rather than a defect, `%(TASKLESS_CLI)s agent feedback`
is the better recipe.

## Goal
Produce one JSON payload that a maintainer could act on without asking
a follow-up question: what was being done, what should have happened,
what did happen. Show it to the user, send it only on their yes, and
delete the file.

## Preconditions
- The user asked to report a Taskless bug, in this conversation.
- The agent can write a file and run a shell command.
- No auth required.

## Steps

1. **Draft every answer from the session.** You usually saw the bug
   happen, so you already hold most of the report:
   - `summary`: one line naming the command or recipe and the defect.
     `check exits 0 when a rule file fails to parse`, not `check is
     broken`.
   - `trying`: what the user was trying to do, and the exact command
     you ran, if there was one.
   - `expected`: what should have happened, and where that expectation
     came from (a recipe, the docs, `--help`) when you know.
   - `actual`: what happened instead. Quote the error message or the
     output that shows it, trimmed to the lines that matter.
   - `context`: anything else that would help fix it, such as the steps
     to reproduce, whether it happens every time, or a workaround you
     found. Omit the key when there is nothing to add.

2. **Ask the user only for what the session does not show.** If you
   did not see the bug yourself, ask what they ran and what happened.
   One question, covering everything missing, not one per field.

3. **Leave version information out.** The CLI adds its version, the
   installed scaffold version, the platform, and the Node.js version to
   the report itself. There is no key for it.

4. **Keep it shareable.** The payload leaves this machine. Leave out
   secrets, tokens, credentials, absolute paths, and any source code the
   user has not chosen to share. Replace a path with its project-relative
   form, and a snippet of their code with a description of its shape.
   An error message or CLI output is fine once it is clean of those.

5. **Write the payload** to `.taskless/.tmp-feedback.json`, matching the
   input schema below, with `"kind": "bug"`. Use the keys exactly as
   given; the CLI maps them to the survey's own question identifiers.

6. **Show it, and wait for a yes.** Put every key in the chat, labelled
   and written out in full, exactly as it will be sent, and say that
   the CLI will add version information. Ask whether to send it.
   - **Yes.** Go to step 7.
   - **Corrections.** Apply them, rewrite the file, show the payload in
     full again, and ask again. Send only on the user's go-ahead.
   - **No.** Delete the file and carry on with the user's task. Nothing
     is sent.

7. **Send.** Run:
   ```
   %(TASKLESS_CLI)s feedback send --from .taskless/.tmp-feedback.json --json
   ```
   On success the command prints a thank-you. If it says telemetry is
   disabled, nothing was sent: tell the user that, and that they can
   file the bug at https://github.com/taskless/cli/issues instead, using
   the payload you showed them as the issue body.

8. **Clean up.** Delete `.taskless/.tmp-feedback.json` whether the call
   succeeded or failed.

9. **Return to the user's task.** Thank them in one line. If you found a
   workaround, offer it, then carry on.

## Input schema

The `--from` JSON file conforms to:

```json
%(INPUT_SCHEMA)s
```

`kind` is always `bug`. `summary`, `trying`, `expected`, and `actual`
are required. `context` is optional, and an omitted key is how it is
left out, not an empty string.

## Important Notes

- Do NOT send before the user has seen the payload and said yes.
- Do NOT guess at the cause in `actual`. Say what happened; a theory of
  why belongs in `context`, labelled as one.
- Do NOT run `%(TASKLESS_CLI)s feedback dismiss` here. It answers the
  survey invite, which this is not.
- The event carries the same anonymous or logged-in identity as the
  CLI's other telemetry. If the user asks, say so plainly.

## Errors

With `--json`, failures emit `{ ok: false, code, message }`:

| code            | meaning                                     | fix                                                   |
|-----------------|---------------------------------------------|-------------------------------------------------------|
| `INVALID_INPUT` | `--from` missing, unreadable, or failed validation | the message names the field; fix the payload and retry |

## See Also

- `%(TASKLESS_CLI)s agent feedback`: for an opinion or a wish rather than a defect
- `%(TASKLESS_CLI)s agent`: the topic index, if you arrived here by mistake
