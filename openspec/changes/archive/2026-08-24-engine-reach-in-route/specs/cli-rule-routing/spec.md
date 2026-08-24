## ADDED Requirements

### Requirement: Route states each local engine's reach from the pinned engine versions

The `route` recipe SHALL state what each local engine can actually read, so
that an agent choosing between `create-sg-rule`, `create-vale-rule`, and the
runtime destinations is not left to guess whether an engine parses the language
in front of it.

The recipe SHALL state, for the ast-grep engine, the set of languages the
pinned ast-grep release parses, spelled as a rule's `language:` field must
spell them. It SHALL state, for the Vale engine, that Vale treats a file
according to its extension in tiers — markup, comment text only, and a
plaintext fallback that lints an unparsed file as whole-file prose — and that a
set of formats fails rather than lints because Vale delegates their parse to an
external converter this CLI does not ship. The recipe SHALL state that such a
failure aborts the entire Vale pass rather than skipping the offending file.

These statements SHALL be **derived from the pinned engine versions rather
than transcribed into the recipe text**. The recipe SHALL carry substitution
markers resolved at render time from constants that name the engine version
they were taken from, and those constants SHALL be pinned to the engines'
observable behaviour by tests that invoke the engine binaries. A transcribed
list would go stale on the next engine bump with nothing to detect it, and a
stale claim about engine reach is more harmful than no claim, because an agent
acts on it.

The recipe SHALL NOT treat a language absent from both engines' reach as
automatically requiring the runtime tier. It SHALL direct the agent to consider
`create-legacy-rule` first, since a linter the repository already runs may
cover the language, and that destination requires no login.

The recipe SHALL distinguish an engine's reach from an engine's availability.
Reach is a property of the pinned engine version; availability is a property of
the host on which the CLI is running, and a language within reach is still
unusable where the engine's platform binary did not resolve.

#### Scenario: Route names ast-grep's languages

- **WHEN** the rendered `route` recipe is read
- **THEN** it SHALL name the languages the pinned ast-grep release parses, including `Yaml`
- **AND** an agent SHALL be able to conclude from it that a rule over a GitHub Actions workflow is expressible as an `sg` rule

#### Scenario: Route names Vale's tiers and its unreadable formats

- **WHEN** the rendered `route` recipe is read
- **THEN** it SHALL name the extensions Vale parses as markup, the extensions where Vale lints comment text only, and the plaintext fallback that applies to everything else
- **AND** it SHALL name the formats whose parse Vale delegates to an absent external converter
- **AND** it SHALL state that one such file fails the whole Vale pass rather than only itself

#### Scenario: The reach statements carry no unresolved marker

- **WHEN** the `route` recipe is rendered
- **THEN** no `%(…)s` substitution marker SHALL remain in the text an agent receives

#### Scenario: A bumped engine cannot leave the recipe stale

- **WHEN** an engine binary is upgraded to a version whose reach differs from the constants the recipe renders
- **THEN** a vendor-contract test that invokes the engine SHALL fail
- **AND** the recipe SHALL NOT be able to state the superseded reach without that failure

#### Scenario: An unreachable language is not routed to runtime by default

- **WHEN** the rule's language appears in neither engine's reach
- **THEN** `route` SHALL direct the agent to consider `create-legacy-rule` before escalating to a runtime destination
