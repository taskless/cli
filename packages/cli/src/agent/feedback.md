# Topic: feedback     (CLI v%(CLI_VERSION)s / topic v1)

## You are here
This is `feedback`. It helps you send the Taskless team feedback the user
asked to give: something that works well, something that does not, or
something they wish Taskless did. The user started this; no invite did.
If the user is reporting something broken, `%(TASKLESS_CLI)s agent bug-report`
asks the questions a fix needs, and is the better recipe.
If you arrived here from the survey invite at the end of an authoring or
onboarding recipe, you want `%(TASKLESS_CLI)s agent rule-feedback` instead.

## Goal
Produce one JSON payload carrying the user's feedback in their own words
and, if it helps, your account of what led to it. Show it to the user,
send it only on their yes, and delete the file. No GitHub account is
needed.

## Preconditions
- The user asked to give Taskless feedback, in this conversation.
- The agent can write a file and run a shell command.
- No auth required.

## Steps

1. **Get the feedback in the user's words.** If they already said what
   they want to tell Taskless, that is `verbatim`. If they only said they
   have feedback, ask once what it is. Do not paraphrase, shorten, or
   tidy it. If they wrote several messages, join them in order with a
   blank line between.

2. **Add context, if the session has any.** `context` is your account
   of what led to the feedback: the command or recipe involved, what
   happened, what the user was trying to do. A few sentences. Omit the
   key when the feedback stands on its own.

3. **Keep it shareable.** The payload leaves this machine. Leave out
   secrets, tokens, credentials, absolute paths, and any source code the
   user has not chosen to share. Describe instead of quoting: "a
   TypeScript file in the API layer", not its contents. This applies to
   your `context`; the user's own words are theirs to choose, so if
   `verbatim` contains something that looks like a secret, point it out
   at step 5 rather than removing it yourself.

4. **Write the payload** to `.taskless/.tmp-feedback.json`, matching the
   input schema below, with `"kind": "general"`. Use the keys exactly as
   given; the CLI maps them to the survey's own question identifiers.

5. **Show it, and wait for a yes.** Put every key in the chat, labelled
   and written out in full, exactly as it will be sent. Ask whether to
   send it.
   - **Yes.** Go to step 6.
   - **Corrections.** Apply them, rewrite the file, show the payload in
     full again, and ask again. Send only on the user's go-ahead.
   - **No.** Delete the file and carry on with the user's task. Nothing
     is sent, and there is nothing to dismiss.

6. **Send.** Run:
   ```
   %(TASKLESS_CLI)s feedback send --from .taskless/.tmp-feedback.json --json
   ```
   On success the command prints a thank-you. If it says telemetry is
   disabled, nothing was sent: tell the user that, and that they can
   reach the team at https://github.com/taskless/cli/issues instead.

7. **Clean up.** Delete `.taskless/.tmp-feedback.json` whether the call
   succeeded or failed.

8. **Return to the user's task.** Thank them in one line and carry on.

## Input schema

The `--from` JSON file conforms to:

```json
%(INPUT_SCHEMA)s
```

`kind` is always `general`, and `verbatim` is required. `context` is
optional, and an omitted key is how it is left out, not an empty string.

## Important Notes

- Do NOT send before the user has seen the payload and said yes. They
  asked to give feedback, not for you to decide what it says.
- Do NOT edit the user's words. `verbatim` is the one answer that is
  theirs.
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

- `%(TASKLESS_CLI)s agent bug-report`: for something that is broken
- `%(TASKLESS_CLI)s agent`: the topic index, if you arrived here by mistake
