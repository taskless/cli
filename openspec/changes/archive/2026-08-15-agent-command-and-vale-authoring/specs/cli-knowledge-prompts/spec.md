## MODIFIED Requirements

### Requirement: Topic names and accessor shape are stable public API

The set of `PromptTopic` names, the `getPrompt`/`PROMPTS` shape, and the existing fields of `PromptOptions` SHALL be treated as public API; recipe _text_ MAY change freely.

The package is pre-1.0, so a backwards-incompatible change to that surface SHALL be released as a **MINOR** bump. This is what the leading zero means, and it applies to renaming a topic, removing one, or changing the accessor signature.

What the requirement actually protects is not the version number but the notice. `TOPICS` is consumed across a deploy boundary, so a downstream consumer breaks when it upgrades rather than when this package builds, and the version alone cannot warn anyone. A breaking change SHALL therefore name the removed or renamed topics explicitly in its changeset.

#### Scenario: Renaming or removing a topic

- **WHEN** a topic is removed or renamed, or the accessor signature changes
- **THEN** it SHALL be released as a MINOR bump
- **AND** the changeset SHALL name the removed or renamed topics
- **AND** a recipe text edit SHALL require neither

#### Scenario: Adding an option

- **WHEN** a new optional field is added to `PromptOptions`
- **THEN** it SHALL NOT require more than a PATCH bump, since existing call sites keep their behavior

## ADDED Requirements

### Requirement: Exported topics cover every engine a rule can be routed to

`TOPICS` SHALL export the authoring recipe for each engine — `create-sg-rule`, `create-vale-rule`, and `create-runtime-rule`.

A consumer that can decide a rule belongs to an engine must be able to reach the procedure for authoring one. Exporting a chooser without its destinations reproduces, for the platform generator, the dead end this change removes from the CLI.

`engine-selection` leaves the export because it stops existing: the criterion it carried now lives in `route`, stated once. `route` is not exported here — it still contains local mechanics a Worker cannot run — so until it is, a consumer gets each destination's own scope from these three and adjudicates a genuinely ambiguous call itself.

#### Scenario: Every engine's authoring path is reachable from the export

- **WHEN** a consumer imports `TOPICS`
- **THEN** it SHALL contain `create-sg-rule`, `create-vale-rule`, and `create-runtime-rule`

#### Scenario: The exported set follows the rename

- **WHEN** a consumer imports `TOPICS`
- **THEN** it SHALL NOT contain `static` or `engine-selection`, neither of which names a recipe any more
