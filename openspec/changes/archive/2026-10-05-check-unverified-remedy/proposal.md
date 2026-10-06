## Why

When `check` cannot have the rule service verify a project's rules, it says
that runtime rules did not run but never says what would let them run. The
three early paths (`--anonymous`, no token, no resolvable GitHub remote)
attached a reason to each skipped runtime rule and printed no notice, so a
project with no runtime rules got no word at all that its ast-grep and Vale
rules ran unverified. The remote failure discarded the specific problem
`resolveRepositoryUrl` had already identified, and the `organization_not_found`
cause named the condition without the remedy `rule create` gives for it.

Server verification of issued rules is new in 0.12.0. A CI job without a token
is the likeliest place to hit the unauthenticated path, and that path was
silent whenever there were no runtime rules.

The standing spec required the opposite for the logged-out case: "SHALL NOT
emit a warning about missing authentication", from a design that kept routine
offline use quiet. That design also allowed "an informational line", and this
change uses that allowance: a `Notice:`, not a warning, with the exit code
unchanged.

## What Changes

- Every path that leaves rules unverified (`--anonymous`, no token, no
  resolvable GitHub remote, a reconcile that cannot complete) prints ONE
  notice saying the rules were not verified and naming the fix. It prints
  whether or not the project has runtime rules.
- The fix named per cause: `--anonymous` names running without it; no token
  names `auth login` and `TASKLESS_TOKEN`; a remote failure names which of
  not-a-repository, no `origin`, or a non-GitHub `origin` it is; a rejected
  token names `auth login`; `organization_not_found` carries the same two
  steps as `orgNotFoundMessage()`, now shared through `orgNotFoundRemedy()`.
- Each skipped runtime rule's reason becomes the short cause, since the
  notice carries the remedy.
- The `check` recipe goes to topic v6 and describes the notice.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-check`: one ADDED requirement for the notice. Two MODIFIED
  requirements, restated in full: "Check selects what it runs from auth state"
  drops "SHALL NOT emit a warning about missing authentication", and "Check
  accepts --anonymous as a no-op" lets the notice name `--anonymous` as the
  cause instead of matching the unauthenticated output byte for byte.

## Impact

Additive stderr output on unverified runs, and an entry in the `--json`
`notices` array where there was none. `success`, `results`, `skipped` and the
exit code are unchanged; `skipped[].reason` is reworded. `patch`: the package
is pre-1.0.

## Delivery shape

**Single PR.** Spec, implementation, recipe and tests are one small diff, and
the change is archived in it.
