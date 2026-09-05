## MODIFIED Requirements

### Requirement: No check requires an OpenSpec change to be archived

No workflow SHALL fail because a directory other than `archive/` exists under `openspec/changes/`, on a pull request or on `main`. An unarchived change directory is the normal state of work in progress, and no check status reports it.

Two gates were tried and both measured the wrong thing. A pull-request gate had to infer stack position to avoid firing on work still in flight, and a check that is expected-red across most of a stack trains people to ignore red. Moving it to `main` removed those false positives and introduced a worse one: a stack that merges forward leaves its change directory on `main` until the final slice, so `main` ran red for as long as the stack took to drain. A signal that is expected to be red is not a signal.

Both versions detected "work is in progress". What is worth detecting is work that stalled and was abandoned, and the directory looks identical in either case, so neither gate could tell them apart.

The replacement reports through channels that tolerate being wrong — a pull-request label, a job summary, and a tracking issue — rather than through a check status. Those signals are specified below. None of them fails a check, so this requirement is unchanged in what it forbids: reporting exists, blocking does not.

#### Scenario: Unarchived change on a pull request does not fail

- **WHEN** a pull request carries an unarchived change directory under `openspec/changes/`
- **THEN** no check SHALL fail for it

#### Scenario: Unarchived change on main does not fail

- **WHEN** a commit is pushed to `main` and a directory other than `archive/` exists under `openspec/changes/`
- **THEN** no check SHALL fail for it, because a forward-merging stack is expected to leave one there until its final slice

#### Scenario: The reporting signals conclude successfully when they fire

- **WHEN** any OpenSpec reporting signal detects an unarchived or unclaimed change
- **THEN** it SHALL record the finding in a label, a job summary, or an issue, and SHALL conclude the workflow run successfully

#### Scenario: No reporting signal is a step in the validation workflow

- **WHEN** the OpenSpec reporting signals run
- **THEN** none of them SHALL be a step in the workflow named `Validate`, so that a nightly publish triggered by `workflow_run` on that workflow cannot be gated by one

## ADDED Requirements

### Requirement: An unresolved OpenSpec change is labelled on every pull request in its stack

A GitHub Actions workflow SHALL apply the `Open OpenSpec` label to a pull request whose head carries a directory other than `archive/` under `openspec/changes/`, and SHALL remove that label when the head carries none. The determination SHALL be made from the head commit's own tree, without querying pull-request lineage or resolving where the pull request eventually merges.

A stack has not resolved its OpenSpec change until one of its branches archives it, and that is a property of the stack rather than of any branch's position within it. Reading it from the tree gives every pull request in the stack the same answer with no API call to fail. The label is the durable signal: it can be filtered, it survives a re-run, and being occasionally wrong costs nothing, which is what allows the predicate to be simple.

#### Scenario: A pull request holding an unarchived change is labelled

- **WHEN** a pull request's head tree contains a directory other than `archive/` under `openspec/changes/`
- **THEN** the workflow SHALL apply the `Open OpenSpec` label

#### Scenario: The label is removed when the change is archived

- **WHEN** a pull request's head tree contains no directory other than `archive/` under `openspec/changes/`
- **THEN** the workflow SHALL remove the `Open OpenSpec` label if it is present, and SHALL succeed if it is not

#### Scenario: Every branch of a stack receives the same label

- **WHEN** several open pull requests are stacked and the change directory is present in each of their head trees
- **THEN** each SHALL be labelled, because the determination reads the tree rather than the stack

#### Scenario: A fork pull request falls back to the job summary

- **WHEN** the workflow runs on a pull request from a fork and cannot write the label
- **THEN** it SHALL record the finding in the job summary, SHALL state that the label could not be applied, and SHALL conclude successfully
- **AND** it SHALL NOT use the `pull_request_target` event to obtain a writable token

### Requirement: The tip of a stack is warned when it leaves a change unarchived

A GitHub Actions workflow SHALL emit a job-summary warning when a pull request carries an unarchived change under `openspec/changes/` and no other open pull request targets its head branch as a base. It SHALL NOT fail the pull request in any case.

The tip is the last branch that can archive the change before it reaches `main`, so it is the only position where the warning is actionable. Stack position is read from the GitHub API, which introduces a failure mode unrelated to the pull request; the previous version of this check exited non-zero when that read failed, reddening pull requests for `gh` timeouts. Being unable to determine position is not a finding about the pull request and SHALL NOT be reported as one.

#### Scenario: The tip of a stack is warned

- **WHEN** a pull request carries an unarchived change and no open pull request bases on its head branch
- **THEN** the workflow SHALL emit a warning naming the change, and SHALL conclude successfully

#### Scenario: A mid-stack pull request is not warned

- **WHEN** at least one open pull request targets this pull request's head branch as its base
- **THEN** the workflow SHALL emit no warning, because work is still stacked above and the change is not yet due for archiving

#### Scenario: Stack position cannot be determined

- **WHEN** the query for pull requests based on this head branch fails
- **THEN** the workflow SHALL skip the warning, SHALL record that position could not be determined, and SHALL conclude successfully

### Requirement: An unclaimed unarchived change on main opens a tracking issue

A GitHub Actions workflow triggered by pushes to `main` SHALL open or update a tracking issue when a directory other than `archive/` exists under `openspec/changes/` and no open pull request's diff against `main` touches that directory. It SHALL close that issue when the change appears under `archive/`, and SHALL NOT fail the workflow run in any case.

A change on `main` is finished or it has not landed; there is no parked state. So an unarchived change whose work has landed means `openspec/specs/` describes requirements the code has already met — the specs are wrong, not merely out of date, and the issue SHALL say so.

The claim test is what keeps a forward-merging stack quiet: while a stack drains, its remaining pull requests carry the change directory in their diffs, so the change is claimed and nothing is reported. It is a file-path question about open pull requests and SHALL NOT be implemented by reconstructing stack lineage.

Exactly one issue SHALL exist per change. The workflow SHALL locate an existing issue by a machine-readable marker in the issue body rather than by matching its title, and SHALL reopen a closed one rather than opening a second.

#### Scenario: A change left on main with no open claimant opens an issue

- **WHEN** a push to `main` leaves an unarchived change that no open pull request's diff touches
- **THEN** the workflow SHALL open a tracking issue naming the change, stating that the standing specs no longer describe the shipped code, and SHALL conclude successfully

#### Scenario: A draining forward-merging stack reports nothing

- **WHEN** a push to `main` leaves an unarchived change and at least one open pull request's diff touches that change's directory
- **THEN** the workflow SHALL open no issue, because the change is still claimed by work in flight

#### Scenario: Archiving the change closes its issue

- **WHEN** a push to `main` moves a change under `archive/` and a tracking issue for it is open
- **THEN** the workflow SHALL close that issue

#### Scenario: A change that recurs reuses its existing issue

- **WHEN** a tracking issue for a change already exists, whether open or closed
- **THEN** the workflow SHALL update or reopen that issue rather than opening a second one, locating it by the marker in its body

### Requirement: A scheduled sweep backstops the main-side check

A scheduled GitHub Actions workflow SHALL escalate the tracking issue for any change that has been unarchived on `main` for longer than a fixed window, currently seven days. It SHALL determine age from the git history of the change directory and SHALL NOT read file modification times. It SHALL NOT fail the workflow run.

The sweep exists for the case where the push-time check was never evaluated — an administrative merge, a workflow disabled during an outage, a botched down-merge. It is a backstop for a missing evaluation, not a second classifier, so it SHALL NOT parse `tasks.md` and SHALL NOT distinguish finished work from unfinished work. There is no parked state on `main`, so age alone is the whole predicate.

`actions/checkout` stamps every file's modification time to checkout time, so a sweep reading mtime reports every change as fresh regardless of its age.

#### Scenario: A change older than the window is escalated

- **WHEN** the scheduled sweep finds a change unarchived on `main` whose directory has no git activity within the window
- **THEN** it SHALL escalate that change's tracking issue, opening one if none exists, and SHALL conclude successfully

#### Scenario: Age is read from git history

- **WHEN** the sweep determines how long a change has been unarchived
- **THEN** it SHALL read the change directory's git history and SHALL NOT use file modification times

#### Scenario: The sweep does not classify by task completion

- **WHEN** the sweep evaluates a change whose `tasks.md` has unchecked tasks, or which has no `tasks.md`
- **THEN** it SHALL treat the change identically to one whose tasks are all checked, because completeness is not a legitimate reason for a change to remain on `main`
