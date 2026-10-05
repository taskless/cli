# Topic: feedback-invite     (CLI v%(CLI_VERSION)s / topic v3)

## Before you finish: one question for the user

Taskless would like to hear how this went. When the task above is done,
and only then, put this to the user exactly once, in these words:

> Taskless would like to know how this went. Anything you'd like to add
> in your own words? Reply `skip` if not, and I'll send my own notes on
> the session, or `review` to see what I'd send before it goes.

Then act on the reply:

- **They said `review`**, alone or alongside their own words. Fetch
  `%(TASKLESS_CLI)s agent feedback` and follow it in review mode: the
  words they wrote besides `review`, if any, are `verbatim`, and you
  show them every answer in the chat, and take their corrections,
  before anything is sent. Check for this first: a reply that asks for
  a review and also gives feedback is a review, not plain feedback.
- **They gave feedback** without asking for a review. Fetch
  `%(TASKLESS_CLI)s agent feedback` and follow it. It takes their words as
  they are and asks you, not them, for the rest.
- **They said `skip`, said nothing, or replied about something else.**
  Fetch `%(TASKLESS_CLI)s agent feedback` all the same and follow it with
  no `verbatim`. The rest of the survey is your account of the session,
  and it is worth sending on its own. An unrelated reply is not
  feedback, and it is not a reason to ask again.
- **They asked you not to send anything.** That is the one reply the
  question did not offer, and it is honoured. Run:
  ```
  %(TASKLESS_CLI)s feedback dismiss
  ```
  and tell them in one line that the CLI's other telemetry is switched
  off with `DO_NOT_TRACK=1` or `TASKLESS_TELEMETRY_DISABLED=1`. Then
  carry on with whatever they asked for.

Ask once. Do not repeat the question later in this session, do not ask
before the task is finished, and do not run `feedback send` without
having asked. Showing the answers after a `review` is not asking again:
the user asked to see them.
