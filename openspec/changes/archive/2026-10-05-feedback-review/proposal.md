## Why

The 0.12.0 survey sends the agent's own account of the session whenever the
user replies `skip`, and its answers are written by the agent, not the user.
The user is told notes will be sent but never sees what they say. A user who
would be content to send them, after a look, has no way to take that look
short of refusing outright, which loses the account entirely.

## What Changes

- **The invite offers `review`** beside `skip`. The sentence it puts to the
  user gains ", or `review` to see what I'd send before it goes."
- **A `review` reply opens a third door.** The agent fetches `agent feedback`
  as for any other reply; the word `review` is the request, and anything else
  the user wrote alongside it is still `verbatim`.
- **The feedback recipe gains a review step before the send.** The agent puts
  every answer in the chat, labelled by key and exactly as it will be sent,
  names the keys it omitted, and asks whether to correct anything. After each
  round of corrections it shows the corrected payload again, and it sends only
  on the user's go-ahead. It runs `feedback dismiss` if the user decides not
  to send after all. `ruleKind` cannot be dropped, since
  it is required, but its wording can be corrected.
- **The no-follow-up rule keeps one exception.** Showing the answers after a
  `review`, and again after each correction, is not asking again: the user
  asked to see them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-feedback-survey`: "The feedback and feedback-invite recipes" is
  restated in full with the `review` door, the review step, and a new
  scenario. All four existing scenarios are carried unchanged.

## Impact

Two embedded recipes, `feedback` and `feedback-invite`, move to topic v3. No
schema, command, or telemetry event changes: a reviewed payload is sent by the
same `feedback send --from` call as any other.

The bump is `patch`. The survey has not shipped (`latest` is `0.11.2` and its
changeset is still pending), so the existing `feedback-survey-0-12-0`
changeset is extended rather than a second one added.

## Delivery shape

**Single PR.** Two recipe edits, their tests, and this delta are one small
diff, archived on this PR.
