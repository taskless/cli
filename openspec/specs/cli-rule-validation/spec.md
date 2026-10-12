# cli-rule-validation Specification

## Purpose

How `validate` and `verify` judge a rule: addressed by path rather than by id, run against the engine's own fixtures, and naming the constraint that a rejection violated.

## Requirements

### Requirement: Rules are validated and verified by path, not by id

The CLI SHALL provide `validate <path>` and `verify <path>`. Both SHALL accept a path to a rule's canonical location or to any directory above it, and SHALL resolve the owning engine from the path's position under `.taskless/rules/<engine>/` rather than by parsing the file.

An id does not name one thing. The same id can exist under `sg` and under `vale`, so an id-addressed command has to either guess or report an ambiguity; a path has neither problem. Resolving the engine from position — never from content — is the same rule dispatch follows, so a rule cannot be validated by one engine and executed by another.

Addressing a rule by path is what removes the ambiguity from the COMMAND. It does not make the project's layout correct: the two rules still share one metadata sidecar, and `validate` reports that as a failure of each rule. The two are separate answers to separate questions, and neither replaces the other.

#### Scenario: A rule path resolves to its engine

- **WHEN** `validate .taskless/rules/vale/no-simply` is run
- **THEN** the CLI SHALL validate it as a Vale rule

#### Scenario: The same id under two engines is not ambiguous

- **WHEN** `no-simply` exists under both `rules/sg/` and `rules/vale/`
- **THEN** each is addressed by its own path
- **AND** neither command SHALL require the user to disambiguate
- **AND** each rule SHALL still be reported as failing validation, because the id is held by two engines

#### Scenario: A directory means everything beneath it

- **WHEN** `validate .taskless/` is run
- **THEN** every rule beneath it SHALL be validated, each against its own engine
- **AND** the command SHALL report per-rule results rather than a single pass or fail

#### Scenario: A path outside any engine's rules directory is rejected

- **WHEN** a path resolves to no engine
- **THEN** the CLI SHALL exit non-zero naming the path, rather than guessing an engine

### Requirement: The generation loop runs validate and verify

The rule generation loop SHALL run `validate` and then `verify` against a newly authored or newly delivered rule, and SHALL treat a failure of either as a rule that is not ready to report as complete.

#### Scenario: A generated rule is checked before it is reported

- **WHEN** a rule is authored locally or written by the service
- **THEN** the loop SHALL run `validate` and `verify` against its path
- **AND** SHALL surface a failure rather than reporting the rule as written

### Requirement: The Vale rule schema is pinned to the vendored binary

The Vale rule schema's vocabulary SHALL be derived from the vendored binary by a generator in this repository, written to a checked-in artifact pinned to `VALE_VERSION`, and a differential test SHALL hold the schema's claims against that binary.

Vale publishes no JSON Schema for its check types. The machine-readable field knowledge exists only behind its hosted MCP server, which is a paid product and unavailable to `validate`. The binary, not the documentation, SHALL therefore be the authority for what the schema asserts — and it SHALL be asked by a script that can be re-run, rather than by hand once. What a transcription loses is not the answer but the question: a later reader inherits a value with no way to reproduce the measurement that produced it.

The generator SHALL take every verdict from the process exit status and the structured JSON output, and SHALL NOT take one by matching output against an error phrase. A configuration error is reported on stderr as an object carrying a `Code`; a crash produces no such object at all. A probe that matches on a phrase scores a crash as a clean run, which has already produced a wrong entry in this schema.

Where the derivation rests on a proposed candidate rather than on a set the binary enumerates, that SHALL be recorded as a limit of the artifact. Vale names the key an author got wrong and never the ones they could have used, and an unrecognized scope raises nothing at all — so field tables and scope operands are verified rather than discovered, and a value nobody proposes is absent.

#### Scenario: A Vale upgrade that invalidates the schema fails loudly

- **WHEN** `VALE_VERSION` is raised to a version whose accepted check types, fields, or scopes differ from the artifact
- **THEN** the differential test SHALL fail
- **AND** the failure SHALL name the construct whose treatment changed

#### Scenario: The generator refuses to emit a vocabulary it cannot read

- **WHEN** the binary's enumeration of its own accepted values no longer matches the shape the generator parses
- **THEN** the generator SHALL fail with an error naming what it could not read
- **AND** it SHALL NOT emit a partial enumeration

A short enum is _stricter_ than the binary, so a silent partial parse would begin rejecting rules Vale accepts — blocking work that would have functioned, which is the worse of the two failure directions.

#### Scenario: A divergence from Vale's documentation is reported, not dropped

- **WHEN** the binary's measured behavior disagrees with Vale's published documentation, in either direction
- **THEN** generation SHALL emit that disagreement as part of its output
- **AND** the artifact SHALL record which side the schema followed

A documented value that never fires is a trap an author walks into with the docs open. An undocumented value that works is evidence that something real may be missing from the candidate list. Neither may be resolved silently.

#### Scenario: The vocabulary describes the binary the build ships

- **WHEN** the checked-in artifact records a different Vale version than `VALE_VERSION`
- **THEN** the build SHALL fail
- **AND** the failure SHALL name the two versions

#### Scenario: Behavior a schema cannot express stays explicit

- **WHEN** a rule shape crashes the binary although every key in it is a legal field of its check
- **THEN** the schema SHALL reject that shape through a check stated alongside the generated field tables
- **AND** the rejection SHALL NOT be encoded as a field-table fact

### Requirement: A rejection names the constraint it violated

`validate --json` and `verify --json` SHALL report, per rule, the constraints a
rejection violated, pairing a `constraintId` drawn from the published
`RULE_CONSTRAINTS` with the message that reports it. Vale config rejections are
attributable in the same way, under `vale-config-*` constraint ids.

The existing `errors` array SHALL continue to carry every failure message,
including those that are attributable. A consumer reading only `errors` SHALL
see what it sees today, so this is additive.

An error with no constraint behind it SHALL NOT be given one. A wrong
attribution sends a reader to a rationale that does not describe their failure,
which is worse than sending them to none.

A consumer SHALL NOT have to match on message text to recover the constraint.
Text matching rots the first time a message is rephrased, and rephrasing an
error message is not a breaking change.

#### Scenario: A mismatched rule id is attributed

- **WHEN** `validate --json` refuses a rule whose `id:` does not match its directory
- **THEN** the rule's result SHALL carry a violation with `constraintId` `sg-id-matches-directory`
- **AND** the violation's message SHALL also appear in `errors`

#### Scenario: An unattributable failure carries no id

- **WHEN** `validate --json` reports a failure that no published constraint describes
- **THEN** the message SHALL appear in `errors`
- **AND** no violation SHALL be reported for it

#### Scenario: A passing rule reports no violations

- **WHEN** `validate --json` accepts a rule
- **THEN** its violations SHALL be empty

#### Scenario: A Vale config rejection is attributed

- **WHEN** `validate --json` rejects a Vale rule whose config assigns a key naming another rule
- **THEN** the rule's result SHALL carry a violation with `constraintId` `vale-config-own-key-only`
- **AND** the violation's message SHALL also appear in `errors`

### Requirement: The schema may reject a pattern the binary accepts only when the pattern can never fire

The Vale rule schema SHALL reject a pattern that the vendored binary loads and runs without complaint, where that pattern cannot produce a finding on any document. Such a rejection SHALL be stated per rule in the style layer, and SHALL NOT be raised in the config layer.

This is a different class from a rejection justified by blast radius. A rule shape that crashes the binary, or a field that draws an `E201`, takes down every other rule's findings for the whole run, and its rejection borrows that justification. A pattern that can never fire takes down nothing: it loads, runs, writes nothing to stderr, and reports nothing — which is exactly what a rule with nothing to say looks like. The author has no signal to act on, at the only moment they are looking, and there is no suppression mechanism anywhere in the CLI for them to reach for if the schema is wrong.

Two obligations follow from that, and they pull against each other.

The rejection SHALL be carried by a detector whose precision is established by measurement against the binary, in both directions: every rejected form SHALL have been measured silent, and every form the detector accepts that could plausibly have been rejected SHALL have been measured firing. Precision is load-bearing here in a way it is not for a blast-radius rejection, because an author facing a false positive cannot suppress it and cannot write the rule.

The rejection's message SHALL carry its own justification rather than pointing at a broken run. It SHALL name the offending key or pattern, SHALL say that the pattern can never match and that the binary reports nothing, and SHALL name the construct to write instead.

#### Scenario: A backreference in a swap key is rejected

- **WHEN** a `substitution` rule's `swap` map carries a key containing a backreference outside a character class
- **THEN** `validate` SHALL reject the rule
- **AND** the message SHALL name the offending key
- **AND** the message SHALL say the key can never match and that Vale reports nothing
- **AND** the message SHALL name `existence` as the check to write instead

#### Scenario: A pattern the binary honors is not rejected

- **WHEN** a `swap` key contains `\1` inside a character class, where it is an octal escape rather than a backreference
- **THEN** `validate` SHALL accept the rule

An escaped backslash before a digit, escaped parentheses, and a non-capturing group are accepted for the same reason: each was measured firing.

#### Scenario: The rejection is scoped to the field that carries the defect

- **WHEN** the same pattern appears in a field of another check that the binary does honor it in
- **THEN** `validate` SHALL accept the rule

The defect belongs to how `substitution` compiles its keys, not to the regex engine, which is shared. Rejecting elsewhere would block a rule that works.

#### Scenario: A widening of the defect fails the vendor contract

- **WHEN** a Vale upgrade makes a neighbouring pattern field compile its patterns the same way
- **THEN** the vendor contract test SHALL fail
- **AND** the failure SHALL name the field whose treatment changed

#### Scenario: A rejection the binary stops earning is removed, not kept

- **WHEN** a Vale upgrade makes a rejected pattern fire
- **THEN** the vendor contract test asserting it silent SHALL fail
- **AND** the schema's rejection SHALL be removed rather than the test relaxed

### Requirement: Validate and verify carry notices as a list

`validate` and `verify` SHALL carry what they have to say about a rule without failing it as an ordered list in which one element is one notice, and SHALL NOT join several notices into one element with any separator.

In human output the CLI SHALL print one `   notice:` marker per notice, and SHALL prefix every line of a notice that spans lines. Under `--json` each per-rule result SHALL carry a `notices` array of strings, present and empty when there is nothing to say rather than absent, so a consumer can tell "nothing to report" from "this CLI does not report notices" — the same distinction `violations` beside it already draws.

A notice SHALL be reported on a rule that passed as well as on one that failed, and SHALL NOT affect the exit code.

#### Scenario: Two advisories about one rule are two notices

- **WHEN** one rule draws both a style-layer advisory and a config-layer advisory
- **THEN** `validate --json` SHALL report them as two elements of that rule's `notices`
- **AND** human output SHALL print each behind its own `notice:` marker

#### Scenario: Two language advisories on one sg rule stay separate

- **WHEN** an sg rule declares an accepted-but-off-list `language:` spelling AND a `files:` glob that language cannot parse
- **THEN** `validate` SHALL report the two as separate notices rather than as one joined line

#### Scenario: A rule with nothing to report carries an empty list

- **WHEN** `validate --json` reports a rule that drew no advisory
- **THEN** that rule's `notices` SHALL be present and empty

### Requirement: Verify reports the findings an ast-grep rule's fixtures produced

`verify` SHALL report, for an ast-grep rule whose fixtures produced matches, the findings those fixtures produced, in the same shape the other engines report theirs. A consumer SHALL NOT be able to tell which engine produced a finding except by its `source`.

The rendered `message` is what this exists for. `ast-grep test` decides only whether each `invalid:` snippet fired and each `valid:` one stayed quiet, and a rule whose message interpolates its metavariables can have the slots in the wrong order while satisfying both — so the verdict cannot see the defect and the message is the only thing that can.

The findings SHALL be gathered independently of the verdict and SHALL NOT change it. `ast-grep test` remains what decides whether the rule passed; a failure to gather findings SHALL be reported as a rule with no findings rather than as a rule that failed.

A finding SHALL name the fixture FILE that declares the snippet, as a project-relative path, not the temporary or synthetic name any scanning mechanism used internally. Where the snippet is a literal block scalar, the position SHALL be the snippet's real position in that file, so the author can open it directly.

#### Scenario: The rendered message is reported, not just the verdict

- **WHEN** `verify --json` runs against an ast-grep rule whose `invalid:` snippet matched
- **THEN** the rule result SHALL carry a finding for that snippet
- **AND** the finding's `message` SHALL be the message as ast-grep rendered it, with the rule's metavariables already interpolated
- **AND** a rule whose message names the same metavariables in the other order SHALL produce a different `message`, so the two cannot both pass

#### Scenario: A finding points back into the fixture file

- **WHEN** an ast-grep fixture snippet produces a finding
- **THEN** the finding's `file` SHALL be the project-relative path of the test YAML declaring the snippet
- **AND** SHALL NOT be a temporary path or ast-grep's name for a stream
- **AND** where the snippet is a literal block scalar, the finding's line and column SHALL be its position in that file rather than its position within the snippet

#### Scenario: Both buckets are reported, and named in ast-grep's vocabulary

- **WHEN** `verify --json` reports an ast-grep rule's findings
- **THEN** a finding from an `invalid:` snippet SHALL carry the `fail` bucket
- **AND** a finding from a `valid:` snippet SHALL carry the `pass` bucket
- **AND** the `fail` bucket SHALL be reported even when the rule passed

#### Scenario: A valid snippet that wrongly fired is printed without --json

- **WHEN** `verify` runs without `--json` and an ast-grep rule fails because a `valid:` snippet fired
- **THEN** the offending findings SHALL be printed under that rule, labelled by bucket
- **AND** they SHALL be rendered the way `check` renders a finding
- **AND** a rule that passed SHALL still print one line and no findings

#### Scenario: A language ast-grep cannot parse degrades to no findings

- **WHEN** an ast-grep rule declares a `language:` the vendored binary does not recognise
- **THEN** `verify` SHALL report that rule as carrying an empty `findings` array
- **AND** SHALL NOT fail to produce a report
- **AND** the failure SHALL NOT suppress any other rule's findings

#### Scenario: Collecting findings writes nothing to disk

- **WHEN** `verify` collects an ast-grep rule's fixture findings, whether the rule passes or fails
- **THEN** no file SHALL be left behind in the project tree or the temporary directory
- **AND** nothing SHALL be written that a later `check` could report against

### Requirement: Verify runs a rule's fixtures and runs validate first

`verify` SHALL execute a rule against its test material — ast-grep test cases, Vale `pass`/`fail` fixture buckets, or the runtime harness — and SHALL run `validate` first, stopping on a validate failure without running the fixtures.

Ordering is the point. When a rule is both malformed and under-fixtured, the fixture complaint is the less useful of the two errors and is the one that surfaces first if the checks run in the other order — so the author is told their fixtures are incomplete while the reason the rule could never have run goes unmentioned.

A rule that populates only one bucket has proved only half of what a rule claims, whatever its engine. An engine SHALL NOT be trusted to report this itself: `ast-grep test` reports an empty `invalid:` bucket as `1 passed; 0 failed` and exits zero, so a rule that has never matched anything is indistinguishable from one that passed.

A runtime rule's fixtures execute code, so they SHALL run only when `--dangerously-run-scripts` is passed, and under no other mechanism. `verify` SHALL NOT consult the rule service to decide this, and SHALL make no network request in the course of running fixtures.

That is deliberately stricter than the policy `check` applies, not softer. `check` executes rules as a side effect of scanning a repository, so a blessed signature admits code the user never asked to run and a reconcile stands between the request and the execution. `verify` runs fixtures because the user asked for them, so the verb is the consent and the flag is the confirmation; a rule that `check` would run unflagged on a blessed signature still requires the flag here. Nothing executes under `verify` that would not have executed under the shared policy.

A run refused for want of the flag SHALL be reported as not run, and SHALL be reported as neither a pass nor a failure: the rule is not defective, and no action available to its holder would make a failure green. The refusal SHALL name the flag, and SHALL NOT direct the reader to authenticate — authenticating cannot bless a rule that never left the working tree, so naming it would offer a fix that is not one.

`verify` SHALL report, per rule, the findings its fixtures produced, as a `findings` array carrying the same finding shape `check --json` prints — `source`, `ruleId`, `severity`, `message`, `file`, `range`, `matchedText` and the optional `note` and `fix` — plus the `bucket` the fixture that produced it belongs to.

The RENDERED message is the point, and it is what a verdict cannot carry. A rule whose message interpolates its captures can have its slots in the wrong order and still fire on every `fail/` fixture and stay quiet on every `pass/` one, so a boolean verdict reports it as a rule that passed. The only evidence that the message says what its author meant is the message as the engine rendered it, against material the author wrote, which `verify` already has in hand and discards.

The array SHALL be present on every rule result and SHALL be empty rather than absent when there is nothing to report — including for an engine that does not yet surface its fixture findings, a rule whose validation failed before fixtures ran, and a run the execution policy refused. A consumer SHALL NOT have to distinguish "this rule produced no findings" from "this command does not report findings", because a key that is sometimes absent is one a reader learns to treat as optional, and the reading that follows is that its absence means zero.

Fail-bucket findings SHALL be reported under `--json` on a passing run. They are the evidence, and a payload that carries the evidence only once the rule is already failing carries it at the one moment it is no longer needed.

The human rendering SHALL stay a single line per passing rule. Under a FAILING rule it SHALL print the findings that bear on the failure, labelled by bucket, using the same renderer `check` prints findings with, so one finding does not read two ways depending on which command surfaced it. A pass-bucket finding SHALL be printed there: it is a fixture that wrongly fired, and naming the file says only that it happened, while the finding says what matched.

#### Scenario: A malformed rule reports the malformation, not the fixtures

- **WHEN** `verify` runs against a rule that is both invalid and missing a fixture bucket
- **THEN** it SHALL report the validation error
- **AND** it SHALL NOT report the fixture coverage as the failure

#### Scenario: Another rule's config error does not fail this rule's fixtures

- **WHEN** `verify` runs against one `sg` rule while a different `sg` rule in the project is one ast-grep refuses
- **THEN** the rule under verification SHALL be judged on its own fixtures alone
- **AND** its result SHALL NOT carry the other rule's error

#### Scenario: Vale fixtures are tested per bucket

- **WHEN** `verify` runs against a Vale rule
- **THEN** every `fail/` document SHALL produce at least one finding for that rule
- **AND** every `pass/` document SHALL produce none
- **AND** a rule populating only one bucket SHALL be reported as unverified rather than passing

#### Scenario: ast-grep fixtures are counted per bucket

- **WHEN** `verify` runs against an ast-grep rule
- **THEN** the `valid:` and `invalid:` entries SHALL be counted across every `-test.yml` file the rule owns
- **AND** a rule populating only one bucket SHALL be reported as unverified rather than passing
- **AND** a rule whose buckets are all empty or absent SHALL be reported as unverified rather than passing
- **AND** a green `ast-grep test` run SHALL NOT on its own be sufficient to report the rule as passing

#### Scenario: Runtime fixtures are run per case

- **WHEN** `verify` runs against a runtime rule with `--dangerously-run-scripts`
- **THEN** each directory under `.tests/fail/` SHALL be passed to the check as its `root` and SHALL produce at least one finding
- **AND** each directory under `.tests/pass/` SHALL be passed as its `root` and SHALL produce none
- **AND** a rule populating only one bucket SHALL be reported as unverified rather than passing
- **AND** a rule holding no fixture cases at all SHALL be reported as unverified rather than passing

#### Scenario: A runtime rule without the flag is reported as not run

- **WHEN** `verify` runs against a runtime rule without `--dangerously-run-scripts`
- **THEN** the rule SHALL NOT be reported as passing
- **AND** the output SHALL say the fixtures did not run and why
- **AND** the output SHALL name `--dangerously-run-scripts` as what would run them
- **AND** the output SHALL NOT direct the reader to authenticate
- **AND** the rule SHALL NOT be counted among the rules verified
- **AND** the refusal alone SHALL NOT fail the command

#### Scenario: Verifying a runtime rule reaches no network

- **WHEN** `verify` runs against a runtime rule, with or without `--dangerously-run-scripts`
- **THEN** the CLI SHALL NOT request a token, resolve an organization, or reconcile
- **AND** the outcome SHALL NOT depend on authentication state, a git remote, or the availability of the rule service

#### Scenario: A case that never reaches the check is reported as a fixture defect

- **WHEN** a fixture case produces no narrow matches, so the check is never invoked
- **THEN** the CLI SHALL report that case as a fixture defect naming the case
- **AND** SHALL say the check did not run
- **AND** SHALL do so whether the case is in `pass/` or `fail/`, since a case that never invokes the check is evidence about the fixture rather than about the rule

#### Scenario: A check that throws is distinguished from one that finds nothing

- **WHEN** a runtime rule's check raises while running a fixture case
- **THEN** that SHALL be reported as the check failing, not as the case producing no findings

#### Scenario: Verify reports the findings its fixtures produced

- **WHEN** `verify --json` runs against a rule whose fixtures produced findings
- **THEN** each rule result SHALL carry a `findings` array
- **AND** each entry SHALL carry the rendered `message`, `file`, `range`, `matchedText` and `severity` that `check --json` reports for the same finding
- **AND** each entry SHALL name the bucket of the fixture that produced it
- **AND** the fail-bucket findings SHALL be reported even when the rule passed

#### Scenario: The findings array is present and empty rather than absent

- **WHEN** `verify --json` reports a rule that produced no findings, whose validation failed before its fixtures ran, whose run was refused, or whose engine does not surface fixture findings
- **THEN** the rule result SHALL still carry a `findings` array
- **AND** that array SHALL be empty

#### Scenario: A failing rule prints the findings that bear on the failure

- **WHEN** `verify` runs without `--json` and a rule fails because a `pass/` fixture fired
- **THEN** the offending findings SHALL be printed under that rule, labelled by bucket
- **AND** they SHALL be rendered the way `check` renders a finding
- **AND** a rule that passed SHALL still print one line

### Requirement: Validate refuses a rule id held by more than one engine

`validate` SHALL fail a rule whose id is also a directory name under another engine, and the failure SHALL name every engine directory holding the id and the `.taskless/rule-metadata/<id>.yml` sidecar they share, and SHALL say to rename one of them. `verify` SHALL inherit the refusal, because `verify` runs `validate` first.

The check SHALL be made per rule, not only over the whole project. `validate` is invoked on a single rule as well as on the tree, and validating the rule an author has just written is the moment the collision is cheapest to fix; a project-wide pass that only diffs the per-engine id lists reports nothing at exactly that moment. The project-wide form follows from running the per-rule check for each rule.

The condition SHALL be described the way `rules delete` already describes it, which refuses the same state under `RULE_ID_AMBIGUOUS`. One condition described in two vocabularies is how a reader comes to believe it is two conditions.

The failure SHALL NOT be attributed to a published `RULE_CONSTRAINTS` entry. Every constraint is declared for one engine and published per engine, because a constraint states what this CLI requires of a rule for that engine beyond what the engine itself requires. A collision requires nothing of the rule: the file is valid, and what is wrong is that a sibling tree holds the same directory name.

The write path SHALL NOT refuse. `check`'s repair path calls `writeRuleFile`, so refusing there would leave both colliding rules unrepairable, which is worse than the silence it would replace. A warning after the write is the write path's whole contribution.

#### Scenario: A colliding pair fails from either side

- **WHEN** `no-eval` exists under two engines and `validate` runs against either one
- **THEN** the rule SHALL fail
- **AND** the failure SHALL name both engine directories

#### Scenario: Validating one rule catches a collision with another engine

- **WHEN** `validate` runs against a single rule whose id is also held by another engine
- **THEN** it SHALL report the collision without being run over the whole tree

#### Scenario: A tree with no collision passes

- **WHEN** every rule id in the project is held by exactly one engine
- **THEN** `validate` SHALL report no collision for any rule

#### Scenario: The collision carries no constraint id

- **WHEN** `validate --json` reports a collision
- **THEN** the message SHALL appear in `errors`
- **AND** no violation SHALL be reported for it

#### Scenario: Writing a colliding rule warns rather than refusing

- **WHEN** a rule is written whose id another engine already holds
- **THEN** the rule SHALL be written
- **AND** the caller SHALL receive a warning naming both directories

### Requirement: Validate checks a rule's required components

`validate` SHALL check that a rule has the components its engine requires and that they are well formed, and SHALL NOT require fixtures or test cases to exist.

The two commands split because they have different preconditions. An agent part-way through authoring has a rule and no fixtures yet, and needs to know the rule itself is valid before it can write a meaningful test for it.

The names say which question each command answers. `validate` asks whether the rule is well formed and decides it from the rule's files alone, so its answer is deterministic and needs no human judgement: it belongs in a generator's inner loop and in CI. `verify` asks whether the rule checks what its author currently wants, which only fixtures the author wrote can answer.

Per engine, `validate` SHALL check:

| Engine    | Components                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `sg`      | `<id>.yml` against the ast-grep schema and the Taskless required fields, then one parse of that rule alone by the vendored ast-grep |
| `vale`    | `<id>.yml` against the Vale rule schema and the Taskless required fields, and the rule's `.vale.ini` against the config schema      |
| `runtime` | `check.ts` present, and at least one capture rule under `captures/`                                                                 |

The `sg` parse exists because the schema cannot decide everything the engine refuses. Which `kind` names are valid depends on the grammar, and the binary cannot list them: a keyword token such as `readonly`, or a Markdown inline construct such as `link`, passes the schema and is refused by ast-grep with exit 8. The parse SHALL be made over a configuration holding only the rule being validated, so the error it reports belongs to that rule. The parse SHALL NOT run the rule's fixtures and SHALL NOT scan the project.

The `vale` row previously read "against Vale's own validation." Measured against the pinned 3.18.0 binary, that covers less than it claims: `level: bananas` is reported, while `extends: nonsense` and `scope: fenced` both validate clean and produce a rule that matches nothing. Vale validates a rule when it _runs_ one, and it runs one field at a time — so a name it does not recognize is not an error, it is a check that never fires. Schema validation is therefore its own layer for `vale`, as it already is for `sg`.

#### Scenario: A rule with no fixtures still validates

- **WHEN** `validate` runs against a rule whose fixture buckets are empty or absent
- **THEN** it SHALL report on the rule's components only
- **AND** the absence of fixtures SHALL NOT be a validate failure

#### Scenario: A malformed rule reports its own error

- **WHEN** a Vale style declares a `level` outside `suggestion`/`warning`/`error`
- **THEN** `validate` SHALL report that error, naming the field

#### Scenario: An unrecognized extension point is rejected

- **WHEN** a Vale style declares an `extends` that is not one of Vale's check types
- **THEN** `validate` SHALL report it, naming the field and the accepted values
- **AND** it SHALL NOT report the rule as valid

#### Scenario: An unrecognized scope is rejected

- **WHEN** a Vale style declares a `scope` that is not one of Vale's scope values
- **THEN** `validate` SHALL report it, naming the field
- **AND** a scope using the `~` negation or `&` chaining syntax over recognized values SHALL be accepted

#### Scenario: A field belonging to another check type is rejected

- **WHEN** a Vale style declares a field its `extends` does not accept, such as `tokens` on an `occurrence` check
- **THEN** `validate` SHALL report it before Vale is invoked

The failure it prevents is not a local one: Vale reports this as `E201: has invalid keys` and reads one assembled config per run, so a single rule with a stray field suppresses every other Vale rule's findings.

#### Scenario: A rule config that never enables the rule is rejected

- **WHEN** a Vale rule's `.vale.ini` declares matchers but no `<id>.<id> = YES`
- **THEN** `validate` SHALL report that the rule is present but off, naming the file

#### Scenario: A rule config that carries BasedOnStyles is rejected

- **WHEN** a Vale rule's `.vale.ini` assigns `BasedOnStyles` in any matcher, with any value
- **THEN** `validate` SHALL report it under `vale-config-no-based-on-styles`, naming the line
- **AND** it SHALL NOT report the rule as valid

#### Scenario: A rule config that assigns a foreign key is rejected

- **WHEN** a Vale rule's `.vale.ini` assigns a `<style>.<check>` key naming a different rule
- **THEN** `validate` SHALL report it, naming the key and the line
- **AND** it SHALL NOT report the rule as valid

#### Scenario: A rule config advisory does not fail validate

- **WHEN** a Vale rule's `.vale.ini` assigns the same key twice inside one matcher, and another matcher still enables the rule
- **THEN** `validate` SHALL report the rule as valid
- **AND** the repeat SHALL be printed as a notice on that rule

#### Scenario: A rule config whose only enable is overridden is rejected

- **WHEN** a Vale rule's `.vale.ini` assigns `<id>.<id> = YES` and then `<id>.<id> = NO` in its only matcher
- **THEN** `validate` SHALL report that the rule is present but off, under `vale-config-enabled-somewhere`
- **AND** the repeat SHALL still be printed as a notice on that rule

#### Scenario: A kind the grammar does not have is rejected

- **WHEN** an `sg` rule passes the schema but names a `kind` the vendored ast-grep refuses, such as `readonly`
- **THEN** `validate` SHALL reject the rule, carrying ast-grep's own error message
- **AND** it SHALL NOT report the rule as valid

#### Scenario: An engine config error is reported under the rule that has it

- **WHEN** `validate` runs over a directory holding one `sg` rule ast-grep refuses and one it accepts
- **THEN** only the refused rule SHALL fail
- **AND** the error SHALL be reported under that rule's id
- **AND** the accepted rule SHALL be reported as valid

#### Scenario: An engine refusal carries no constraint id

- **WHEN** `validate --json` reports a rule the ast-grep parse refused, and no published constraint describes the refusal
- **THEN** the message SHALL appear in `errors`
- **AND** no violation SHALL be reported for it

#### Scenario: A top-level strictness is rejected

- **WHEN** an `sg` rule declares `strictness:` at the top level of the file rather than inside a pattern object
- **THEN** `validate` SHALL reject the rule under `sg-no-top-level-strictness`
- **AND** the message SHALL say that ast-grep ignores the key there and name the pattern object as where it belongs

### Requirement: Validate reports known ast-grep authoring traps as notices

`validate` SHALL report, as a notice on the rule, each of the following shapes in an `sg` rule. These are the traps the `create-sg-rule` recipe lists as silent: the rule parses, runs and exits zero while missing what its author meant it to match.

| Trap                                         | Reported when                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$$$` next to a comma                        | a pattern places a `$$$` metavariable directly beside a `,`, and that pattern is not an object pattern declaring `strictness: ast`                                                                                                                                                       |
| a sibling relation that stops at punctuation | a `follows` or `precedes` relation declares no `stopBy`                                                                                                                                                                                                                                  |
| an awaited generic call hides its callee     | a rule whose `language:` is `TypeScript` or `Tsx` keys a relation on the callee (`field: function`) with a `regex` anywhere beneath it, covering both a bare function (`identifier`) and a method (`member_expression`), and no alternative in that relation names an `await_expression` |

A trap notice SHALL NOT fail the rule and SHALL NOT affect the exit code. Each shape has legitimate uses (a sibling relation that is meant to stop at the neighbour, a pattern meant to require at least one argument), so `validate` cannot know which one the author meant. A trap the author faces only as a notice is one they can decide about, and a trap that fails the rule is one they cannot write past.

Each notice SHALL name the construct it found and the workaround, so the author does not need the recipe open to act on it.

A trap that ast-grep itself refuses (a keyword or Markdown inline construct named as a `kind`, a `language:` it does not recognise) is not a notice. The engine parse already rejects it.

#### Scenario: A comma beside $$$ draws a notice

- **WHEN** an `sg` rule's pattern is `foo($A, $$$)` as a plain string
- **THEN** `validate` SHALL report the rule as valid
- **AND** the rule SHALL carry a notice naming the pattern and `strictness: ast`

#### Scenario: A pattern that already uses strictness ast draws no notice

- **WHEN** an `sg` rule's pattern is an object whose `context` is `foo($A, $$$)` and which declares `strictness: ast`
- **THEN** the rule SHALL carry no `$$$` notice

#### Scenario: A sibling relation without stopBy draws a notice

- **WHEN** an `sg` rule declares `follows: { kind: number }` with no `stopBy`
- **THEN** the rule SHALL carry a notice naming `follows` and `stopBy: end`
- **AND** the same relation declaring `stopBy: end` SHALL carry none

#### Scenario: A callee regex under TypeScript draws a notice

- **WHEN** a `TypeScript` rule matches `kind: call_expression` with `has: { field: function, kind: identifier, regex: "^rpc$" }`
- **THEN** the rule SHALL carry a notice saying an awaited generic call is not matched, and naming the `await_expression` branch as the workaround
- **AND** the same rule under a language other than `TypeScript` or `Tsx` SHALL carry none
- **AND** the same rule with an `any` alternative naming `kind: await_expression` SHALL carry none

#### Scenario: A method callee regex under TypeScript draws a notice

- **WHEN** a `TypeScript` rule keys on `field: function` with `kind: member_expression` and a `regex` on its `property`
- **THEN** the rule SHALL carry the awaited-generic-call notice

#### Scenario: A trap notice does not fail verify

- **WHEN** `verify` runs against a rule whose only finding from `validate` is a trap notice, and whose fixtures pass
- **THEN** the rule SHALL be reported as passing
- **AND** the notice SHALL be reported on it
