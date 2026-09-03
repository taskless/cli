## MODIFIED Requirements

### Requirement: Exported topics cover every engine a rule can be routed to

`TOPICS` SHALL export `route`, the recipe that chooses an authoring destination, and the authoring recipe for each engine it can choose — `create-sg-rule`, `create-vale-rule`, and `create-runtime-rule`.

A consumer that can decide a rule belongs to an engine must be able to reach the procedure for authoring one, and a consumer that can author for each engine must be able to reach the choice between them. Exporting either half alone strands the other, and the two are not symmetric in their consequences: a consumer missing a destination stops, while **a consumer missing the chooser writes its own**, which is the divergence this export exists to prevent.

`route` was withheld on the grounds that it contains local mechanics a service consumer cannot run, and that such a consumer could adjudicate a genuinely ambiguous call from the three destinations. The first is true and does not follow: a consumer ignores the mechanics, which is a smaller adaptation than restating the criteria. The second was tried and failed in production — the platform generator hand-wrote the same judgement, reached a two-value classification with no way to name `vale`, and generated every prose rule as an ast-grep rule while its own delivery layer could already serve a Vale one.

`engine-selection` leaves the export because it stops existing: the criterion it carried now lives in `route`, stated once.

#### Scenario: The chooser is reachable from the export

- **WHEN** a consumer imports `TOPICS`
- **THEN** it SHALL contain `route`
- **AND** `route` SHALL be a member of `PromptTopic`

#### Scenario: Every engine's authoring path is reachable from the export

- **WHEN** a consumer imports `TOPICS`
- **THEN** it SHALL contain `create-sg-rule`, `create-vale-rule`, and `create-runtime-rule`

#### Scenario: The exported set follows the rename

- **WHEN** a consumer imports `TOPICS`
- **THEN** it SHALL NOT contain `static` or `engine-selection`, neither of which names a recipe any more
