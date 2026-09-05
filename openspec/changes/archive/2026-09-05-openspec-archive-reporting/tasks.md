## 1. Pull-request signals

- [x] 1.1 Add `.github/workflows/openspec-label.yml`: on `pull_request`
      (`opened, reopened, synchronize, ready_for_review`), no `branches:` filter.
      Determine from the head tree whether any directory other than `archive/`
      exists under `openspec/changes/`, and apply or remove the `Open OpenSpec`
      label accordingly. `permissions: pull-requests: write`.
- [x] 1.2 Handle the fork case: when the token cannot write the label, record the
      finding in the job summary, say the label could not be applied, and exit 0.
      Do NOT reach for `pull_request_target`; leave a comment saying why.
- [x] 1.3 Add the tip warning to the same workflow: when the change is present
      and `gh pr list --base <head_ref>` returns no open pull requests, emit a
      job-summary warning naming the change.
- [x] 1.4 On a failed `gh pr list`, skip the warning, record that position could
      not be determined, and exit 0 — the opposite of the deleted
      `pr-check-openspec.yml`, which exited 1 here.
- [x] 1.5 Carry the reasoning in header comments the way `changeset.yml` does:
      why the predicate reads the tree instead of the stack, and why nothing
      fails.

## 2. Main-side tracking issue

- [x] 2.1 Add `.github/workflows/openspec-tracking.yml`: on `push: branches:
  [main]`, `permissions: contents: read, issues: write, pull-requests: read`.
- [x] 2.2 For each unarchived change, test whether any open pull request's diff
      against `main` touches `openspec/changes/<name>/`. Claimed → report
      nothing.
- [x] 2.3 Unclaimed → open or update one tracking issue per change, located by a
      machine-readable marker in the body (not by title match), reopening a
      closed one rather than opening a second.
- [x] 2.4 Write the issue body to state the consequence: the standing specs in
      `openspec/specs/` describe requirements the shipped code has already met.
      Include the change name, the commit that landed it, and the archive command.
- [x] 2.5 Close the tracking issue when the change appears under `archive/`.
- [x] 2.6 Never fail the run. Assert this in a comment next to the trigger, with
      the reason: `Validate` is the only workflow the nightly listens to, and a
      red `main` for a draining stack is what got the previous version deleted.

## 3. Scheduled backstop

- [x] 3.1 Add `.github/workflows/openspec-sweep.yml`: `schedule` plus
      `workflow_dispatch`, `fetch-depth: 0`.
- [x] 3.2 Escalate the tracking issue for any change with no git activity in its
      directory for seven days, opening one if none exists. Age from `git log`,
      never mtime — carry the `actions/checkout` note from the deleted
      `openspec-rot.yml`.
- [x] 3.3 No `tasks.md` parsing and no DONE/STALE split: there is no parked state
      on `main`, so age is the whole predicate. Say so in the header comment.
- [x] 3.4 Do not fail the run; escalate through the issue so there is one channel.

## 4. Specification and verification

- [x] 4.1 Land the `infrastructure` delta: the MODIFIED requirement restated in
      full with both existing scenarios intact, plus the four ADDED requirements.
- [x] 4.2 Verify no signal is a step in `validate.yml`, so `workflow_run:
  workflows: [Validate]` cannot reach any of them.
- [x] 4.3 Exercise the label workflow both ways on a scratch pull request:
      present → labelled, archived → label removed.
- [x] 4.4 Exercise the claim test against the stack shape that motivated it — an
      unarchived change on `main` with an open pull request touching its
      directory must report nothing.
- [x] 4.5 Run the pre-archive scenario inventory from `CLAUDE.md` before
      archiving, and confirm the `infrastructure` spec gains the four
      requirements without losing a scenario from the modified one.
- [x] 4.6 `pnpm openspec validate --all --strict` and `pnpm lint`.
