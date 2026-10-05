## 1. Recipes

- [x] 1.1 Add `review` to the invite sentence and a `review` door that
      fetches `agent feedback` in review mode, keeping any other words as
      `verbatim`.
- [x] 1.2 Add the review step to the `feedback` recipe before the send:
      show every answer, name omitted keys, re-show after each correction until the user
      gives the go-ahead,
      dismiss on a change of heart.
- [x] 1.3 Narrow the no-follow-up rule in both recipes to allow the
      correction rounds, and bump both topics to v3.

## 2. Tests

- [x] 2.1 Update the pinned invite sentence.
- [x] 2.2 Assert the invite's `review` door names `agent feedback` and not
      `feedback dismiss`.
- [x] 2.3 Assert the feedback recipe's review step shows the answers, offers
      correction, names `feedback dismiss`, and precedes `feedback send`.

## 3. Spec and release

- [x] 3.1 Restate "The feedback and feedback-invite recipes" in full with
      the review door and a new scenario.
- [x] 3.2 Extend the unreleased `feedback-survey-0-12-0` changeset.
- [x] 3.3 Dry-run `openspec archive` and confirm every prior scenario
      survives, then archive on this PR.
