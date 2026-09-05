## Context

Two deleted workflows (`pr-check-openspec.yml`, `openspec-rot.yml`) and one
deleted `validate.yml` step attempted this. Their removal commit `8d1f3a1` and
the standing requirement `No check requires an OpenSpec change to be archived`
are the record of why. This design keeps that requirement's invariant — nothing
fails — and adds reporting underneath it.

## Decisions

### D1. The label predicate asks nothing about stack position

Three predicates were available:

| Predicate                                                  | Where it breaks                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tasks.md` fully checked                                   | Silent ~9% of the time. 5/55 archived changes have 1–3 unchecked stragglers, including both landed this week |
| open PR bases on this head (the old tip test)              | Correct, but needs the GitHub API to answer, so it has a failure mode that is not about the PR               |
| **diff `origin/main...head` carries an unarchived change** | Pure content. No API, no lineage, no eventual-target resolution                                              |

The third is chosen for the label because the label is a **stack-wide fact**:
"this stack has not yet resolved its OpenSpec change" is true of every branch in
the stack, so no branch needs to know where it sits. It is the same question
`changeset.yml` asks, taken over the same range, and that shape has not misfired.

The second predicate survives, but only to scope the **warning** — the one place
where "am I the tip?" is genuinely the question being asked. Where the old
workflow exited 1 when `gh pr list` failed, this one skips the warning and
records that it could not tell. A warning that cannot fail cannot fail closed.

### D2. `main` uses a claim test, not a timer

The push-time check on `main` fires when an unarchived change exists **and** no
open pull request's diff touches its directory. The claim test is what
distinguishes your good state from your bad one, and it is not stack-position
reasoning — it is a file-path question about open pull requests, which has a
dependable answer.

Measured on the stack that just drained: PR #265 touched 6 files under
`openspec/changes/`, #266 touched 2, #267 touched 6. Every slice claims the
change, because each slice ticks its own boxes in `tasks.md`, which lives in the
change directory. So the check stays silent for the entire drain and fires on the
first push after the last claimant merges — exactly the transition worth naming.

This depends on slices touching the change directory. When one does not, the
issue opens early; the cost is one issue that closes itself on the next push. The
old design's cost for the same uncertainty was a red `main`.

### D3. The escalation channel is an issue, because it must survive being ignored

Every previous version reported through a check status, and each one failed for a
channel reason rather than a logic reason: expected-red on a draining stack, red
for a `gh` timeout, red on `main` for a week. An issue is durable, assignable,
searchable, and colours nothing.

One issue per change, found by a marker in the body rather than by title match,
reopened rather than duplicated, and closed automatically when the directory
appears under `archive/`. Its body states the consequence — the specs currently
describe a world the code has left — rather than asking for a chore.

### D4. The sweep does not fail either

`openspec-rot.yml` failed the scheduled run. That is a weaker version of the same
mistake: a recurring red that is not attached to anything actionable. The sweep
escalates the existing issue instead, so there is exactly one channel and one
place to look.

Its window is a backstop for the push-time check never having been evaluated —
an admin merge, a botched down-merge, a workflow disabled during an outage. It is
not a second classifier, so it needs no `tasks.md` parsing and no DONE/STALE
split. **7 days**, carried over from the deleted workflow; the number was never
the problem.

Age is read from `git log` on the change directory, never from file mtime.
`actions/checkout` stamps every file to checkout time, so mtime reports every
change as fresh — the deleted workflow got this right and the note is worth
keeping.

### D5. Forks get the warning, not the label

Labelling requires `pull-requests: write`. A `pull_request` run from a fork gets
a read-only token, so the label step cannot write.

**`pull_request_target` is rejected.** It runs with a writable token against the
base repository, and reaching for it to set a cosmetic label would trade a
missing label for a privilege-escalation surface. The fork path falls back to the
job summary alone and says the label could not be set.

This repository's OpenSpec work is not fork-driven today, so the fallback is
mostly future-proofing.

### D6. The nightly cannot be affected, by construction

`release-cli-nightly.yml` triggers on `workflow_run: workflows: [Validate]`,
matched by the `name:` string in `validate.yml` rather than by path. Any signal
that is not a step inside that workflow is invisible to the nightly. All four
signals here live in their own files, so "yell without blocking the nightly"
holds because of the trigger shape, not because of a rule someone follows.

## Risks

**The claim test can be fooled by a slice that touches nothing under
`openspec/changes/`.** Cost is a self-closing issue. Accepted.

**An issue is easier to ignore than a red check.** True, and deliberate: the
previous three attempts were impossible to ignore and were ignored anyway, by
being routed around. The sweep is the answer to a genuinely stale issue.

**Label writes are one more `pull-requests: write` grant.** Scoped to a workflow
that runs no repository code and does not check out the tree.
