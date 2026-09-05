## Why

An unarchived change directory on `main` is not a chore left undone. It means
`openspec/specs/` is **currently wrong**: some percentage of the requirements
described there are already met by code that shipped, and the spec still
describes the world before it. Nothing reports this, in either direction, and
the specs quietly drift out of agreement with the repository.

Two gates tried to catch it and both were deleted in `8d1f3a1` for producing
"more false positives than signal":

| Gate                     | Predicate                                      | How it failed                                                                        |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pr-check-openspec.yml`  | tip = no open PR targets this head as its base | **Blocked.** Also failed _closed_: a `gh` hiccup reddened a PR for unrelated reasons |
| `openspec-rot.yml`       | DONE (all tasks checked) or STALE (7d idle)    | Split into two categories to infer intent, and guessed                               |
| a step in `validate.yml` | any unarchived directory on `main`             | Ran `main` red for the whole time a forward-merging stack drained                    |

They were the right idea. The predicates were roughly correct and the execution
put them in a channel that cannot survive being wrong: **a red check.** A signal
expected to be red is not a signal, and one that reds a pull request for a
`gh pr list` timeout teaches people to route around it.

Two things have changed since, and together they make the idea workable.

**Nothing needs to block.** The `Open OpenSpec` label already exists in this
repository. A label is durable, filterable, and costs a shrug when it is wrong —
so the predicate no longer has to be perfect to be worth running.

**There is no parked state.** A change on `main` is finished or it is not on
`main` yet; go completely or not at all. That single rule deletes the part of
the old sweep that actually misfired. `openspec-rot.yml` carried DONE and STALE
as separate categories precisely because it was trying to infer whether an
unfinished change was abandoned or merely slow. With no legitimate unfinished
state on `main`, there is nothing to infer: unarchived and unclaimed is a fault,
full stop. No `tasks.md` parsing, no intent detection.

The measurement supports dropping `tasks.md`: 5 of 55 archived changes shipped
with 1–3 stragglers unchecked out of 22–37 tasks, so "all boxes ticked" goes
silent about 9% of the time. It is a discipline signal, not a completion signal.

## What Changes

Four signals, **none of which fail any check**, replacing the two deleted gates.

**Every pull request in a stack carries the `Open OpenSpec` label** while its
branch leaves an unarchived change at head. The question is content-only, taken
across `origin/main...head` exactly as `changeset.yml` takes its own: it asks
nothing about stack position, which is the one shape in this repository that has
never misfired. The label is removed when the branch archives the change, so its
presence on a stack is the live answer to "does this stack contain a resolution
to its OpenSpec change?"

**The tip of a stack is warned**, via job summary, when it holds the label and
no open pull request bases on its head. This is the old tip predicate, but where
the old one exited non-zero on a `gh` failure it now skips the warning and says
so. It cannot fail closed because there is nothing to fail.

**`main` opens a tracking issue** when it carries an unarchived change that no
open pull request's diff touches. That claim test is what keeps a
forward-merging stack quiet: measured on the stack that just landed, PRs #265,
#266 and #267 each touched files under `openspec/changes/`, so every slice
claims the change while it drains. The issue closes itself when the change is
archived, and its body says the specs are wrong rather than that a chore is
owed.

**A scheduled sweep** escalates the same issue for any change unarchived on
`main` beyond a window, regardless of whether the push-time check ever ran. Age
comes from `git log`, never file mtime — `actions/checkout` stamps every file to
checkout time, so mtime always looks fresh. This is a backstop for the primary
check never having been evaluated, not a second classifier.

**The nightly is untouched, structurally.** `release-cli-nightly.yml` triggers on
`workflow_run: workflows: [Validate]`, matched by the name string in
`validate.yml`. None of these four signals is a step in that workflow, so none of
them can gate a nightly publish. Constraint satisfied by trigger shape rather
than by anyone remembering it.

## Delivery shape

**Single PR.** The spec delta, the four workflow changes, and the archive land
together. The pieces are only correct as a set — the label written by one
workflow is read by another, and the `main` job's claim test assumes the label
job has been running — so no intermediate state is independently safe. The diff
is well under the ~1200-line guidance: four workflow files and one spec delta.

## Non-goals

**No auto-archiving.** A `## MODIFIED Requirements` block replaces a standing
requirement wholesale and silently deletes any scenario it omits. Applying that
unattended is the one thing that must not happen. Proposing an archive PR whose
body carries the before/after scenario inventory is a plausible follow-on, and is
deliberately out of scope here.

**No change to what blocks a merge.** Branch protection still requires
`Validate` and nothing else.
