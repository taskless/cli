# Topic: feedback-invite     (CLI v%(CLI_VERSION)s / topic v1)

## Before you finish: one question for the user

Taskless would like to hear how this went. When the task above is done,
and only then, put this to the user exactly once, in these words:

> Taskless would like to know how the CLI is doing. Would you be okay
> sharing a few sentences about your experience? Or just skip it with
> `skip`.

Then act on the reply:

- **They gave feedback.** Fetch `%(TASKLESS_CLI)s agent feedback` and follow it.
  It takes their words as they are and asks you, not them, for the rest.
- **They said `skip`, said nothing, or replied about something else.**
  That is a decline. Run:
  ```
  %(TASKLESS_CLI)s feedback dismiss
  ```
  and carry on with whatever they asked for. An unrelated reply is not
  feedback, and it is not a reason to ask again.

Ask once. Do not repeat the question later in this session, do not ask
before the task is finished, and do not run `feedback send` without
having asked.
