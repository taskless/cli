# cli-rule-fixtures Specification

## Purpose

One fixture contract for every rule engine: where a rule's test cases live, what a case is, and how one is judged. Verifying a rule runs the same check that scanning a repository runs, so a rule that passes its fixtures behaves the same way in `check`.

## Requirements

### Requirement: A rule's fixtures are case directories under tests/pass and tests/fail

Every rule, whatever its engine, SHALL keep its fixtures at `tests/pass/<case>/` and `tests/fail/<case>/` inside its rule directory. A case SHALL be a directory, and its name SHALL be the case's description. A case MAY hold any number of files at any depth.

Each bucket SHALL be read one level deep. An entry directly under `pass/` or `fail/` that is not a directory SHALL be an error naming the path, not an ignored entry. An entry directly under `tests/` other than `pass/` and `fail/` SHALL be an error naming the path. Buckets SHALL be read independently, and a bucket that exists but cannot be read SHALL be an error rather than an empty bucket.

**Rationale.** One shape for every engine is what lets one loop verify every rule. A case is a directory rather than a document because the engines that scope by path judge a file by where it sits, so a case has to be able to place a file at the path the rule expects. A runtime rule's evidence also spans files. The strict reads keep a fixture that was written but never ran from passing in silence: a skipped loose file is a fixture nobody mentioned, and a swallowed permission error makes a two-sided rule look one-sided and a one-sided rule look complete. An engine-native test file left in `tests/`, such as an ast-grep test YAML, is refused for the same reason. It would otherwise sit beside the cases and never run.

#### Scenario: A case is a directory named for what it shows

- **WHEN** a rule holds `tests/fail/npx-latest/.github/workflows/ci.yml`
- **THEN** `npx-latest` SHALL be one `fail` case
- **AND** every file beneath it SHALL belong to that case

#### Scenario: A loose file in a bucket is refused

- **WHEN** `tests/pass/` contains a file directly rather than inside a case directory
- **THEN** verification SHALL report an error naming that path
- **AND** SHALL NOT skip it in silence

#### Scenario: A stray entry in tests is refused

- **WHEN** `tests/` contains an entry other than `pass/` and `fail/`, such as `<id>-test.yml`
- **THEN** verification SHALL report an error naming that path

#### Scenario: An unreadable bucket is not an empty bucket

- **WHEN** a bucket exists but cannot be read
- **THEN** verification SHALL report the failure
- **AND** SHALL NOT treat the bucket as holding no cases

### Requirement: A fixture case is judged by the engine's own check with the case as its root

Verification SHALL judge each case by running the rule's engine the way `check` runs it, over the case directory as the project root: the same executable, the same walk, and the same rule config, narrowed to the rule under verification. A `fail/` case SHALL pass when it produces at least one finding for that rule. A `pass/` case SHALL pass when it produces none. Findings SHALL NOT be counted against line, column, message, or number. A rule's test is whether it fires and whether it stays quiet.

The rule's scope SHALL apply: an ast-grep rule's `files:` and `ignores:`, and the matchers in a Vale rule's own `.vale.ini`. A fixture for a scoped rule therefore places its files at paths the scope accepts.

Each case SHALL be judged in isolation from every other rule in the project. A rule the engine refuses elsewhere in the project SHALL NOT affect the verdict or the findings of the rule under verification.

Verification SHALL write nothing to the rules tree. Whatever it writes to run the engine SHALL live in a temporary directory outside the project and SHALL be gone when the run ends.

The findings a case produces SHALL be the findings `verify` reports for it, in the shape `check --json` prints, with `file` naming the fixture file as a project-relative path.

**Rationale.** A fixture is evidence about the rule as it will run. Every earlier fixture path diverged from `check` in some way. ast-grep snippets were judged by `sg test` and scanned over stdin, which bypasses `files:`. Vale fixtures ran under a config that enabled the rule everywhere. In both, a rule whose scope never matched a real file passed verification and reported nothing in `check`, and no part of the system could see it. Running the check itself over a smaller root removes the divergence instead of documenting it. It also leaves one thing to keep working instead of two.

#### Scenario: A scoped ast-grep rule's fixture sits at a path the scope accepts

- **WHEN** an ast-grep rule declares `files: [".github/workflows/*.yml"]` and a `fail/` case holds the offending step at `.github/workflows/ci.yml`
- **THEN** the case SHALL produce a finding and pass

#### Scenario: A fixture outside the rule's scope does not fire

- **WHEN** the same rule's `fail/` case holds the offending step at `ci.yml` in the case root
- **THEN** the case SHALL produce no finding
- **AND** verification SHALL report the case as failing

#### Scenario: A pass case that fires fails the rule

- **WHEN** a `pass/` case produces a finding for the rule
- **THEN** verification SHALL fail the rule
- **AND** SHALL report the finding under the `pass` bucket, naming the fixture file

#### Scenario: Another rule's error does not reach this rule

- **WHEN** a rule is verified while a different rule of the same engine is one the engine refuses
- **THEN** the rule under verification SHALL be judged on its own cases alone

#### Scenario: Verification leaves nothing behind

- **WHEN** verification of any rule finishes, whether it passes or fails
- **THEN** nothing SHALL have been written under `.taskless/rules/`
- **AND** nothing SHALL remain that a later `check` could report against

### Requirement: A quiet fail case is diagnosed against the rule's scope

When a `fail/` case of an ast-grep or Vale rule produces no finding, verification SHALL run that case once more with the rule's scope removed. If that run produces a finding, the failure SHALL say that the rule's scope excluded the case and name the scope that did it. Otherwise it SHALL say the rule did not match. The diagnostic run SHALL NOT change the verdict. The case still fails.

**Rationale.** Applying scope to fixtures adds a new way for a correct rule to fail: a fixture at a path the scope does not accept. "Did not fire" points at the pattern, and an author edits the wrong thing. One extra run separates the two causes, and it costs nothing on a passing rule.

#### Scenario: A glob that excludes the fixture is named

- **WHEN** a `fail/` case is quiet under the rule's scope and fires with the scope removed
- **THEN** the failure SHALL say the scope excluded the case
- **AND** SHALL name the `files:` globs or Vale matchers in effect

#### Scenario: A pattern that never matches is reported as such

- **WHEN** a `fail/` case is quiet both with and without the rule's scope
- **THEN** the failure SHALL say the rule did not match the case
- **AND** SHALL NOT blame the scope
