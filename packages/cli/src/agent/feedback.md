# Topic: feedback     (CLI v%(CLI_VERSION)s / topic v3)

## You are here
This is `feedback`. It helps you turn what a user just said about
Taskless into a survey response the CLI can send, and send it.
You reach it from the invite at the end of an authoring or onboarding
recipe, whether the user gave you their words, said `skip`, or said
`review`.
If that is not why you are reading this, re-run `%(TASKLESS_CLI)s agent` and
find the topic you meant.

## Goal
Produce one JSON payload that answers the survey, write it to
`.taskless/.tmp-feedback.json`, send it with `feedback send`, and delete
the file. The whole thing is one short exchange with the user and a few
sentences from you; it is not an interview. The one exception is a user
who replied `review`: they get to see the answers, and correct them,
before they are sent.

## Preconditions
- The invite was put to the user and they replied, or did not. Their
  words, if any, are the only input you take from them.
- The user did not ask you to send nothing. If they did, this is the
  wrong recipe: run `%(TASKLESS_CLI)s feedback dismiss` and continue with what
  they asked for.
- The agent can write a file and run a shell command.
- No auth required.

## You are the respondent

The survey is addressed to you, the agent, not to the user. One answer is
the user's words, if they gave any, and you record them verbatim. The
other six are your own account of the session you just ran: what kind
of rule it was for, whether they got it, what went well, what did not,
what you are running in, and which rule has earned its keep. You
already know all of that.
Do not put the survey's questions to the user one by one.

## Steps

1. **Take the user's reply as it is, if there is one.** Whatever they
   wrote after the invite is `verbatim`. If the reply asked for a
   `review`, that word is the request, not their feedback: leave it out
   of `verbatim`, keep everything else they wrote, and remember to show
   the answers at step 4. Do not paraphrase, shorten, or
   tidy it. If they wrote several messages, join them in order with a
   blank line between. If they said `skip`, said nothing, or replied
   about something else, omit `verbatim` and go on: the rest of the
   survey is yours to answer.

2. **Fill the rest from the session.** Ask the user nothing further;
   the invite already asked for their time once. A `review` does not
   change that: you still answer every key yourself, and the user sees
   your answers rather than being asked for them.
   - `ruleKind`: the engine and what the rule was for, in a phrase
     (`ast-grep, forbid eval in TypeScript`; `vale, no hedging in
     docs`; `runtime, env var must be set`). If the recipe was
     `onboard`, write `none (onboarding)`. This is the one required
     answer.
   - `completed`: `Yes`, `No`, or `Unknown`. Success is binary here. A
     rule that verifies and the user accepted is `Yes`; a rule the user
     abandoned or that never verified is `No`; if the session ended
     before you could tell, `Unknown`. There is no partial.
   - `workedWell`: the steps of the interaction with Taskless that went
     smoothly. Omit the key if nothing stands out.
   - `needsImprovement`: the steps that cost time, needed a retry, or
     that you had to work around. Be specific: name the command, the
     field, or the message. Omit the key if nothing stands out.
   - `agents`: the agent you are, and any agent framework you can see
     the project using, by product name. Only open-source, publicly
     available software belongs here; omit the key rather than name an
     internal or proprietary tool.
   - `mostValuableRule`: of the rules under `.taskless/rules/`, the one
     doing the most for this team and why, if the session gave you a
     view of that. Most sessions will not have; omit the key then, and
     do not ask the user for it.

   Keep your own answers to a few sentences each. The people reading
   them want the shape of the friction, not a transcript.

3. **Write the payload** to `.taskless/.tmp-feedback.json`, matching the
   input schema below. Use the human keys exactly as given; the CLI maps
   them to the survey's own question identifiers, and a payload carrying
   a `$survey_` key is not what it expects.

4. **Show it first, if the user asked for a `review`.** Otherwise go
   straight to step 5. Put every answer in the payload in the chat,
   one per line, labelled with its key and written out in full, exactly
   as it will be sent; name the keys you omitted, so the user can see
   what is not being said too. Then ask whether they would like
   anything corrected before you send it.
   - **Nothing to correct, or a go-ahead.** Send the payload as shown.
   - **Corrections.** Apply them as the user gives them and rewrite the
     file. A correction to your own answer replaces it with what the
     user said; a correction to `verbatim` is theirs to make. A request
     to drop an answer omits its key, except `ruleKind`, which is
     required: say so in one line and keep the user's preferred wording
     for it. Then show the corrected payload in full, the same way, and
     ask again. Repeat until the user is satisfied; send only on their
     go-ahead, never on your own judgement that the corrections are
     done.
   - **They decide not to send it.** That is a refusal, and it is
     honoured: delete the file, run `%(TASKLESS_CLI)s feedback dismiss`, and
     carry on with the user's task.

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

`ruleKind` is required. Every other key is optional, and an optional
answer you have nothing for is an omitted key rather than an empty
string.

## Important Notes

- Do NOT edit the user's words. `verbatim` is the one answer that is
  theirs, and its value to the people reading it is that it is theirs.
- Do NOT invent a follow-up interview. The invite asked once, and this
  recipe asks nothing beyond the correction rounds a `review` earns.
  An answer you cannot give is an omitted key, or `Unknown` for
  `completed`.
- Do NOT send before the user has seen the answers when they asked for
  a `review`. The point of the review is that nothing leaves without
  their look at it.
- If telemetry is disabled in this environment the command says so and
  exits 0 with nothing sent. That is the expected outcome there, not an
  error to retry.

## Errors

With `--json`, failures emit `{ ok: false, code, message }`:

| code            | meaning                                     | fix                                                   |
|-----------------|---------------------------------------------|-------------------------------------------------------|
| `INVALID_INPUT` | `--from` missing, unreadable, or failed validation | the message names the field; fix the payload and retry |

## See Also

- `%(TASKLESS_CLI)s feedback dismiss`: what to run when the user asked for nothing to be sent
- `%(TASKLESS_CLI)s agent`: the topic index, if you arrived here by mistake
