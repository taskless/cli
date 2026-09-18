# Topic: feedback     (CLI v%(CLI_VERSION)s / topic v1)

## You are here
This is `feedback`. It helps you turn what a user just said about
Taskless into a survey response the CLI can send, and send it.
You reach it from the invite at the end of an authoring or onboarding
recipe, after the user replied with something other than `skip`.
If that is not why you are reading this, re-run `%(TASKLESS_CLI)s agent` and
find the topic you meant.

## Goal
Produce one JSON payload that answers the survey, write it to
`.taskless/.tmp-feedback.json`, send it with `feedback send`, and delete
the file. The whole thing is one short exchange with the user and a few
sentences from you; it is not an interview.

## Preconditions
- The user replied to the invite with feedback rather than `skip`,
  silence, or something unrelated. If they did any of those, this is the
  wrong recipe: run `%(TASKLESS_CLI)s feedback dismiss` and continue with what
  they asked for.
- The agent can write a file and run a shell command.
- No auth required.

## You are the respondent

The survey is addressed to you, the agent, not to the user. One answer is
the user's words and you record them verbatim. The other four are your
own account of the session you just ran: what they were trying to do,
whether they got it, what went well, and what did not. You already know
all of that. Do not put the survey's questions to the user one by one.

## Steps

1. **Take the user's reply as it is.** Whatever they wrote after the
   invite is `verbatim`. Do not paraphrase, shorten, or tidy it. If they
   wrote several messages, join them in order with a blank line between.

2. **Ask one follow-up at most, and only if needed.** If the reply is
   feedback but leaves you unable to fill `completed`, ask whether they
   got what they came for. Otherwise ask nothing further; the invite
   already asked for their time once.

3. **Fill the rest from the session.**
   - `goal`: what the user was trying to accomplish, in one or two of
     your own sentences. Name the recipe you were following and the
     rule or task it was for.
   - `completed`: `Yes`, `No`, or `Unknown`. Success is binary here. A
     rule that verifies and the user accepted is `Yes`; a rule the user
     abandoned or that never verified is `No`; if the session ended
     before you could tell, `Unknown`. There is no partial.
   - `workedWell`: the steps of the interaction with Taskless that went
     smoothly. Omit the key if nothing stands out.
   - `needsImprovement`: the steps that cost time, needed a retry, or
     that you had to work around. Be specific: name the command, the
     field, or the message. Omit the key if nothing stands out.

   Keep your own answers to a few sentences each. The people reading
   them want the shape of the friction, not a transcript.

4. **Write the payload** to `.taskless/.tmp-feedback.json`, matching the
   input schema below. Use the human keys exactly as given; the CLI maps
   them to the survey's own question identifiers, and a payload carrying
   a `$survey_` key is not what it expects.

5. **Send.** Run:
   ```
   %(TASKLESS_CLI)s feedback send --from .taskless/.tmp-feedback.json --json
   ```
   Under `--json`, a failure is `{ ok: false, code, message }`; see the
   table below. On success the command prints a thank-you.

6. **Clean up.** Delete `.taskless/.tmp-feedback.json` whether the call
   succeeded or failed. `.taskless/.gitignore` already ignores it, so a
   forgotten file is a stray rather than a commit, but leave nothing
   behind.

7. **Return to the user's task.** Thank them in one line and carry on.
   Do not ask for more, and do not run this recipe a second time in the
   same session.

## Input schema

The `--from` JSON file conforms to:

```json
%(INPUT_SCHEMA)s
```

`verbatim`, `goal`, and `completed` are required. `workedWell` and
`needsImprovement` are optional, and an optional answer you have nothing
for is an omitted key rather than an empty string.

## Important Notes

- Do NOT edit the user's words. `verbatim` is the one answer that is
  theirs, and its value to the people reading it is that it is theirs.
- Do NOT invent a follow-up interview. The invite asked once; step 2 is
  the only question this recipe allows, and only when `completed` would
  otherwise be a guess.
- If telemetry is disabled in this environment the command says so and
  exits 0 with nothing sent. That is the expected outcome there, not an
  error to retry.

## Errors

With `--json`, failures emit `{ ok: false, code, message }`:

| code            | meaning                                     | fix                                                   |
|-----------------|---------------------------------------------|-------------------------------------------------------|
| `INVALID_INPUT` | `--from` missing, unreadable, or failed validation | the message names the field; fix the payload and retry |

## See Also

- `%(TASKLESS_CLI)s feedback dismiss`: what to run when the user declined
- `%(TASKLESS_CLI)s agent`: the topic index, if you arrived here by mistake
