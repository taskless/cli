## ADDED Requirements

### Requirement: Verify and test carry notices as a list

`verify` and `test` SHALL carry what they have to say about a rule without failing it as an ordered list in which one element is one notice, and SHALL NOT join several notices into one element with any separator.

In human output the CLI SHALL print one `   notice:` marker per notice, and SHALL prefix every line of a notice that spans lines. Under `--json` each per-rule result SHALL carry a `notices` array of strings, present and empty when there is nothing to say rather than absent, so a consumer can tell "nothing to report" from "this CLI does not report notices" — the same distinction `violations` beside it already draws.

A notice SHALL be reported on a rule that passed as well as on one that failed, and SHALL NOT affect the exit code.

#### Scenario: Two advisories about one rule are two notices

- **WHEN** one rule draws both a style-layer advisory and a config-layer advisory
- **THEN** `verify --json` SHALL report them as two elements of that rule's `notices`
- **AND** human output SHALL print each behind its own `notice:` marker

#### Scenario: Two language advisories on one sg rule stay separate

- **WHEN** an sg rule declares an accepted-but-off-list `language:` spelling AND a `files:` glob that language cannot parse
- **THEN** `verify` SHALL report the two as separate notices rather than as one joined line

#### Scenario: A rule with nothing to report carries an empty list

- **WHEN** `verify --json` reports a rule that drew no advisory
- **THEN** that rule's `notices` SHALL be present and empty
