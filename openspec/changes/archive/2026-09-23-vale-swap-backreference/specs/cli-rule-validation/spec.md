## ADDED Requirements

### Requirement: The schema may reject a pattern the binary accepts only when the pattern can never fire

The Vale rule schema SHALL reject a pattern that the vendored binary loads and runs without complaint, where that pattern cannot produce a finding on any document. Such a rejection SHALL be stated per rule in the style layer, and SHALL NOT be raised in the config layer.

This is a different class from a rejection justified by blast radius. A rule shape that crashes the binary, or a field that draws an `E201`, takes down every other rule's findings for the whole run, and its rejection borrows that justification. A pattern that can never fire takes down nothing: it loads, runs, writes nothing to stderr, and reports nothing — which is exactly what a rule with nothing to say looks like. The author has no signal to act on, at the only moment they are looking, and there is no suppression mechanism anywhere in the CLI for them to reach for if the schema is wrong.

Two obligations follow from that, and they pull against each other.

The rejection SHALL be carried by a detector whose precision is established by measurement against the binary, in both directions: every rejected form SHALL have been measured silent, and every form the detector accepts that could plausibly have been rejected SHALL have been measured firing. Precision is load-bearing here in a way it is not for a blast-radius rejection, because an author facing a false positive cannot suppress it and cannot write the rule.

The rejection's message SHALL carry its own justification rather than pointing at a broken run. It SHALL name the offending key or pattern, SHALL say that the pattern can never match and that the binary reports nothing, and SHALL name the construct to write instead.

#### Scenario: A backreference in a swap key is rejected

- **WHEN** a `substitution` rule's `swap` map carries a key containing a backreference outside a character class
- **THEN** `verify` SHALL reject the rule
- **AND** the message SHALL name the offending key
- **AND** the message SHALL say the key can never match and that Vale reports nothing
- **AND** the message SHALL name `existence` as the check to write instead

#### Scenario: A pattern the binary honors is not rejected

- **WHEN** a `swap` key contains `\1` inside a character class, where it is an octal escape rather than a backreference
- **THEN** `verify` SHALL accept the rule

An escaped backslash before a digit, escaped parentheses, and a non-capturing group are accepted for the same reason: each was measured firing.

#### Scenario: The rejection is scoped to the field that carries the defect

- **WHEN** the same pattern appears in a field of another check that the binary does honor it in
- **THEN** `verify` SHALL accept the rule

The defect belongs to how `substitution` compiles its keys, not to the regex engine, which is shared. Rejecting elsewhere would block a rule that works.

#### Scenario: A widening of the defect fails the vendor contract

- **WHEN** a Vale upgrade makes a neighbouring pattern field compile its patterns the same way
- **THEN** the vendor contract test SHALL fail
- **AND** the failure SHALL name the field whose treatment changed

#### Scenario: A rejection the binary stops earning is removed, not kept

- **WHEN** a Vale upgrade makes a rejected pattern fire
- **THEN** the vendor contract test asserting it silent SHALL fail
- **AND** the schema's rejection SHALL be removed rather than the test relaxed
