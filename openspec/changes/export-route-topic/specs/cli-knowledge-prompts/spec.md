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

### Requirement: The export provides rendered and raw instruction accessors

The export SHALL provide `getInstructions(topic, options?)` and `getRawInstructions(topic, options?)`, each returning `{ text: string; variables: string[] }`.

`getInstructions` SHALL return finished text — the same string `getPrompt` returns for the same topic and options — alongside the names of the sprintf variables the topic's template contains. `getRawInstructions` SHALL return the **unrendered** template text alongside the same variable names, so a host that knows a value the package cannot know can render it itself.

**Not every variable is one a host can know.** The names a raw consumer receives cover two kinds: values a host may supply — `TASKLESS_CLI` and `PACKAGE_MANAGER_DLX`, each with an agent-fill marker as its default — and values only the package can resolve, which include the build version, the pinned engine capabilities, an input schema, and any pre-composed block a rendering option selects between. A host rendering the raw template itself SHALL substitute the first kind and SHALL take the second from a rendered accessor rather than composing it, because the package's own composition is what keeps the surrounding prose coherent.

`mechanics` and `header` affect the rendered form only. The raw template is what a topic contains before any option is applied, so it carries the placeholders unconditionally.

Both SHALL throw on a topic with no embedded recipe, matching `getPrompt`. The existing internal `getRecipe` accessor SHALL continue to return `undefined` for an unknown topic; the `agent` command distinguishes an unknown topic from a failure and cannot use a throwing accessor.

`variables` SHALL be identical between the two functions for the same topic, since both describe the same template.

#### Scenario: Rendered instructions match the existing accessor

- **WHEN** a consumer calls `getInstructions(t)` and `getPrompt(t)` for the same topic and options
- **THEN** `getInstructions(t).text` SHALL equal `getPrompt(t)`

#### Scenario: Raw instructions are re-renderable

- **WHEN** a consumer renders `getRawInstructions(t).text` with sprintf-js against the same variable values the package used
- **THEN** the result SHALL equal `getInstructions(t).text`

#### Scenario: An unknown topic throws

- **WHEN** either accessor is called with a topic that has no embedded recipe
- **THEN** it SHALL throw, rather than returning an empty or undefined result

#### Scenario: A package-composed variable is not a host-fillable one

- **WHEN** a consumer reads `variables` from a raw accessor
- **THEN** the list SHALL include names the package resolves itself, which a host cannot supply a correct value for

## ADDED Requirements

### Requirement: The host-bound steps are suppressible

`PromptOptions` SHALL accept `mechanics`, defaulting to `true`. When `false`, a recipe's steps that gather evidence by running this CLI SHALL render as a statement of what the caller supplies instead of as a command to run.

The substitution SHALL include the connective the step's own prose continues from, so the step reads as a sentence in both modes. Replacing only the command leaves the prose depending on a clause that is no longer there.

The evidence SHALL NOT be dropped along with the command. A recipe's criteria are stated in terms of what those steps gather, so a consumer told only that the step does not apply loses the inputs rather than the commands.

**Rationale.** `invocation` cannot serve this. It substitutes the launcher inside a command, so a consumer with no CLI that sets it to a phrase renders an instruction to execute something that does not parse — a malformed rendering, which is worse than either honest answer.

#### Scenario: The default renders the command

- **WHEN** a consumer calls `getPrompt(t)` for a topic with host-bound steps
- **THEN** the step SHALL render the command to run, unchanged from what the `agent` command prints

#### Scenario: Suppressing them names what the caller supplies

- **WHEN** a consumer calls `getPrompt(t, { mechanics: false })`
- **THEN** no command to run SHALL appear in those steps
- **AND** the step SHALL name the evidence the caller is expected to provide
- **AND** the surrounding prose SHALL remain grammatical
