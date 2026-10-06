## MODIFIED Requirements

### Requirement: Recovery suggestions follow the plan

The CLI SHALL read the acting organization's `entitlements.restoreRules` from the
`GET /cli/api/v2/whoami` response it already fetches to resolve the organization, and SHALL
NOT make another request for it. The value SHALL be treated as tri-state:

- `true`: the plan includes rule recovery.
- `false`: the plan is known to exclude rule recovery.
- unknown: whoami failed, the matched organization carried no `entitlements` or no boolean
  `restoreRules`, or no organization matched the repository's remotes and the CLI fell back
  to the token's claim.

Only `false` SHALL change what the CLI suggests. Wherever the CLI would name
`taskless rule restore <ruleId>` as the way to repair a rule (an `unsafe` or `missing` rule
reported by `check`, or the source of a rename), a `false` plan SHALL instead be told that
restoring rules is not included in the plan, and given git steps for the rule's directory
under `.taskless/rules/`: a `git restore --source=HEAD` command for a change not yet committed,
and for a committed one a `git log` command that lists the commits that changed it, with a
`git restore --source=<commit>~1` command that puts it back as it was before one of them. The
steps SHALL restore from the commit before a change, never from the change itself: the newest
commit `git log` lists for a deleted rule is the deletion, which does not contain the rule. The
parent SHALL be spelled `~1`, not `^`, which zsh reads as a glob under `extendedglob`. When the rule's
engine is not known, the directory SHALL be given as a pathspec matching the rule id under any
engine. `true` and unknown SHALL produce the suggestions the CLI produced before this
requirement.

This is a suggestion, never a gate. `rule restore` and `rule rollback` SHALL call the service
whatever `restoreRules` says, and SHALL relay a plan refusal as "A plan refusal is an answer,
not a failure of the service" requires. `--json` output SHALL NOT change.

#### Scenario: An edited rule on a plan without recovery gets git steps

- **WHEN** `check` reports sg rule `no-eval-3fa9c21b` as `unsafe` and `restoreRules` is `false`
- **THEN** the message SHALL say restoring rules is not included in the plan
- **AND** SHALL give `git restore --source=HEAD`, `git log` and `git restore --source=<commit>~1` commands for `.taskless/rules/sg/no-eval-3fa9c21b/`
- **AND** SHALL NOT name `taskless rule restore`

#### Scenario: A missing rule of unknown engine gets a pathspec for any engine

- **WHEN** `check` reports rule `foo-1` as `missing` with no known engine and `restoreRules` is `false`
- **THEN** the git steps SHALL name a pathspec matching `foo-1` under any engine directory in `.taskless/rules/`

#### Scenario: A rename on a plan without recovery gets git steps for the source

- **WHEN** `check` reports vale rule `bar-2` as a copy of `foo-1`, `foo-1` is `missing`, and `restoreRules` is `false`
- **THEN** the message SHALL give the git steps for `foo-1`'s directory, then say to delete `.taskless/rules/vale/bar-2/`
- **AND** SHALL NOT name `taskless rule restore`

#### Scenario: Unknown keeps today's suggestion

- **WHEN** whoami fails, or the matched organization has no `entitlements`, or no organization matches the repository
- **THEN** every suggestion SHALL name `taskless rule restore <ruleId>` as before

#### Scenario: The entitlement never blocks a recovery command

- **WHEN** `restoreRules` is `false` and the user runs `taskless rule restore no-eval-3fa9c21b`
- **THEN** the CLI SHALL call the service's restore endpoint
- **AND** SHALL relay its refusal as it does today

#### Scenario: No extra request is made

- **WHEN** `check` or a `rule` subcommand resolves the acting organization
- **THEN** the CLI SHALL call `GET /cli/api/v2/whoami` at most once for that resolution

#### Scenario: A committed deletion is restored from the commit before it

- **WHEN** `check` reports sg rule `foo-1` as `missing`, its deletion is committed, and `restoreRules` is `false`
- **THEN** the `git restore` command for a committed change SHALL take `--source=<commit>~1`
- **AND** following it with the newest commit `git log` lists SHALL put the rule's files back
