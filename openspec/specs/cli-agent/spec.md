# CLI Agent

## Purpose

Defines the `agent` subcommand for the `@taskless/cli` package, including recipe display, embedding, and formatting.

## Requirements

### Requirement: Agent subcommand serves recipes for commands

The CLI SHALL support an `agent` subcommand that accepts at most one positional argument identifying a topic, an optional `--anonymous` boolean flag, AND an optional `--tool <name>` value flag. Topics SHALL be addressed by a single token; the subcommand SHALL NOT join multiple positionals into a topic key. When a topic is provided, the subcommand SHALL look up a matching recipe file embedded at build time using the following resolution order:

1. If `--tool` is set AND `<topic>.<tool>.md` exists in the embedded map, return that file.
2. If `--anonymous` is set AND `<topic>.anonymous.md` exists in the embedded map, return that file.
3. Otherwise, return `<topic>.md`.
4. If none of these exists, exit with code 1 and an error message suggesting `taskless agent` for the topic index.

`--tool` SHALL refuse, with a non-zero exit and a message naming the recipe to use instead, a tool that has its own authoring recipe (`ast-grep`, `vale`) or that cannot hold a rule (`prettier`, `black`). An unrecognized tool name SHALL fall back to `<topic>.md`.

When no positional argument is provided, the subcommand SHALL print a topic index containing a one-paragraph human slug followed by a topic disambiguation table mapping topic names to their summaries.

The subcommand is named for its reader. It serves agents fetching a procedure, not humans asking for help, and single-token addressing exists so a topic name is a literal string an agent copies rather than a phrase it can reorder or paraphrase.

#### Scenario: Agent subcommand for a topic returns the recipe

- **WHEN** a user runs `taskless agent check`
- **THEN** the CLI SHALL print the contents of `check.md` to stdout

#### Scenario: Multi-word topic paths are not resolved

- **WHEN** a user runs `taskless agent rule create`
- **THEN** the CLI SHALL NOT look up `rule-create.md` by joining the positionals
- **AND** it SHALL exit non-zero rather than guessing a topic

#### Scenario: Formerly nested topics are addressed by one token

- **WHEN** a user runs `taskless agent improve-rule`
- **THEN** the CLI SHALL look up `improve-rule.md` and print its contents

#### Scenario: The former command name is gone

- **WHEN** a user runs `taskless help check`
- **THEN** the CLI SHALL NOT print recipe text for `check`

#### Scenario: A tool variant is served

- **WHEN** a user runs `taskless agent create-legacy-rule --tool=ruff`
- **AND** `create-legacy-rule.ruff.md` exists
- **THEN** the CLI SHALL print that file's contents

#### Scenario: An unknown tool falls back to the generic recipe

- **WHEN** a user runs `taskless agent create-legacy-rule --tool=rubocop`
- **AND** no `create-legacy-rule.rubocop.md` exists
- **THEN** the CLI SHALL print `create-legacy-rule.md`

#### Scenario: A tool with its own recipe is refused

- **WHEN** a user runs `taskless agent create-legacy-rule --tool=vale`
- **THEN** the CLI SHALL exit non-zero and name `create-vale-rule` as the recipe to use

### Requirement: Recipe files are embedded at build time

Recipe files SHALL be located at `packages/cli/src/agent/` as `.md` files. The Vite build SHALL embed these files into the CLI bundle via `import.meta.glob` with raw imports. A recipe file SHALL exist for every registered command and subcommand.

#### Scenario: Recipe files are available without filesystem access

- **WHEN** the CLI is invoked via `npx @taskless/cli agent check`
- **THEN** the recipe SHALL be served from the embedded bundle without reading the filesystem

#### Scenario: Recipe file naming convention

- **WHEN** a recipe file is created for the `rule create` subcommand
- **THEN** the file SHALL be named `rule-create.md` in `packages/cli/src/agent/`

### Requirement: Recipe files follow a consistent format

Every recipe file at `packages/cli/src/agent/<topic>.md` SHALL follow the canonical recipe template: a single-line header `# Topic: <name>     (CLI v%(CLI_VERSION)s / topic v<n>)`, followed by `## Goal`, `## Preconditions`, `## Steps`, optional `## Input schema` (for recipes that take `--from`), `## Errors`, and `## See Also` sections in that order. Recipe templates SHALL use sprintf-js `%(KEY)s` named-argument placeholders for all substitution. The header SHALL embed `%(CLI_VERSION)s` for the CLI version. Topics that document a `--from` input SHALL embed `%(INPUT_SCHEMA)s` inside the `## Input schema` fenced code block. The topic version integer in the header SHALL be a literal value maintained by the recipe author and bumped when the recipe changes meaningfully.

#### Scenario: Recipe contains all template sections

- **WHEN** any `<topic>.md` file is read
- **THEN** it SHALL begin with a `# Topic:` header containing `%(CLI_VERSION)s` and the topic version integer
- **AND** SHALL contain `## Goal`, `## Preconditions`, `## Steps`, `## Errors`, and `## See Also` sections in that order

#### Scenario: Recipe with --from input includes JSON schema placeholder

- **WHEN** a topic recipe documents a CLI invocation that uses `--from <file>`
- **THEN** the recipe SHALL contain an `## Input schema` section with a code-fenced block containing the `%(INPUT_SCHEMA)s` placeholder
- **AND** the JSON Schema SHALL be derived at render time from the corresponding Zod schema in `packages/cli/src/schemas/`

#### Scenario: Header version reflects build-time CLI version

- **WHEN** the CLI bundle is built
- **THEN** the recipe header's `%(CLI_VERSION)s` placeholder SHALL be substituted at render time from `packages/cli/package.json`
- **AND** SHALL match the version reported by `taskless info`

### Requirement: Recipe substitution uses sprintf-js named arguments

Recipe rendering SHALL substitute placeholders via `sprintf-js` using its named-argument form (`%(KEY)s`). The renderer SHALL build a variables table for each render call containing three flavors of substitution:

1. **System-resolved values** — keys whose values come from runtime state. The renderer SHALL provide `CLI_VERSION` (resolved from the build-time version constant) for every render. The renderer SHALL provide `INPUT_SCHEMA` only when the recipe content contains the `%(INPUT_SCHEMA)s` placeholder; the value is the JSON Schema rendered from the topic's Zod schema in `packages/cli/src/schemas/`, or the literal string `"(no input schema for this topic)"` when no Zod schema is registered for the topic.
2. **Agent-fill markers** — keys whose values render as a lowercase angle-bracket token of the same name (e.g. `PACKAGE_MANAGER_DLX` renders as `<package-manager-dlx>`). The renderer SHALL provide `PACKAGE_MANAGER_DLX` for every render. Agent-fill markers exist so the consuming agent can substitute the value at execution time without the recipe having to invent a per-recipe placeholder convention.
3. **Conditional blocks** — keys whose value is one of a fixed set of whole passages, selected by state the caller passes in. A conditional block SHALL span an entire syntactic unit of the surrounding markdown — a whole list item, a whole numbered step — and SHALL include the grammatical connective the neighbouring prose continues from. The renderer SHALL NOT remove or rewrite text after rendering to achieve a conditional effect: a post-render strip cannot promise that the unconditioned rendering is byte-for-byte what it was, and it leaves the prose depending on a clause that is no longer present. Every conditional block SHALL have a default passage used when the caller supplies no state, and that default SHALL be the unconditioned text a consumer with no host — the `@taskless/cli/prompts` export among them — receives.

The renderer SHALL additionally provide `TASKLESS_CLI` for every render. It is a hybrid of the first two flavors: system-resolved when the caller or the build knows the answer, and an agent-fill marker when neither does. It SHALL resolve in this order:

1. The caller-supplied invocation, when one is given.
2. The build-target invocation, when the build target is not prod — a `nightly`, `dev`, or `self` build knows exactly what it is and SHALL name itself.
3. Otherwise the agent-fill marker `<taskless-cli>`.

Step 3 SHALL NOT fall back to `npx @taskless/cli`. A prod build that does not know how it was launched has no basis for naming one launcher over another, and a marker asks the reading agent for the answer instead of asserting a wrong one.

No flavor SHALL read ambient host state. The render path is imported by Workers without `nodejs_compat`, so a value that can only be learned from `process`, the environment, `argv`, the filesystem, or `PATH` SHALL be detected in the CLI and passed in as a render option.

Recipe authors SHALL escape any literal `%` character in recipe content as `%%` per sprintf-js conventions. The renderer SHALL NOT introduce any other placeholder syntax (`{{KEY}}`, `${KEY}`, etc.); all substitution SHALL flow through the sprintf-js named-argument table.

#### Scenario: CLI_VERSION substitutes the build-time version

- **WHEN** any recipe is rendered
- **THEN** every `%(CLI_VERSION)s` occurrence SHALL be replaced with the build-time CLI version

#### Scenario: INPUT_SCHEMA substitutes only when present in the recipe

- **WHEN** a recipe contains `%(INPUT_SCHEMA)s`
- **THEN** it SHALL be replaced with the JSON Schema rendered from the topic's Zod schema
- **AND** when no Zod schema is registered for the topic, the placeholder SHALL render as `(no input schema for this topic)`

#### Scenario: PACKAGE_MANAGER_DLX renders as an agent-fill marker

- **WHEN** any recipe contains `%(PACKAGE_MANAGER_DLX)s`
- **THEN** the rendered output SHALL contain the literal token `<package-manager-dlx>` at every occurrence

#### Scenario: A conditional block renders its default with no caller state

- **WHEN** a recipe containing a conditional block is rendered with no state supplied for it
- **THEN** the block SHALL render its default passage
- **AND** the surrounding markdown SHALL remain well-formed

#### Scenario: A conditional block replaces a whole unit

- **WHEN** a conditional block selects a passage other than its default
- **THEN** the replaced region SHALL be a whole list item or a whole numbered step, connective included
- **AND** no text SHALL be removed from the rendered output after substitution

#### Scenario: TASKLESS_CLI renders a caller-supplied invocation

- **WHEN** a recipe containing `%(TASKLESS_CLI)s` is rendered with an explicit invocation
- **THEN** every occurrence SHALL render as that invocation

#### Scenario: TASKLESS_CLI names a non-prod build target

- **WHEN** a recipe containing `%(TASKLESS_CLI)s` is rendered with no explicit invocation from a `nightly`, `dev`, or `self` build
- **THEN** every occurrence SHALL render as that build's own invocation, so a nightly names `@taskless/cli-nightly` at its published version rather than the released package

#### Scenario: TASKLESS_CLI falls back to an agent-fill marker

- **WHEN** a recipe containing `%(TASKLESS_CLI)s` is rendered from a prod build with no explicit invocation
- **THEN** every occurrence SHALL render as the literal token `<taskless-cli>`
- **AND** SHALL NOT render as `npx @taskless/cli` or any other guessed launcher

#### Scenario: No legacy placeholder syntax remains in recipes

- **WHEN** any `<topic>.md` file under `packages/cli/src/agent/` is read
- **THEN** it SHALL NOT contain a `{{KEY}}` mustache-style placeholder
- **AND** all substitution SHALL be expressed as `%(KEY)s` sprintf-js named arguments

### Requirement: onboard topic is registered in the agent index

An agent topic `onboard` SHALL be registered. The CLI SHALL embed `packages/cli/src/agent/onboard.md` at build time via the existing `import.meta.glob` mechanism. `taskless agent onboard` SHALL print the contents of `onboard.md`. The topic SHALL appear in the output of `taskless agent` (the index) with a one-line summary describing it as the post-install rule-discovery flow.

#### Scenario: The onboard topic returns the recipe

- **WHEN** a user runs `taskless agent onboard`
- **THEN** the CLI SHALL print the contents of `onboard.md` to stdout
- **AND** SHALL exit with code 0

#### Scenario: Topic index includes onboard

- **WHEN** a user runs `taskless agent` (no args)
- **THEN** the topic index SHALL include a row for `onboard`
- **AND** the row SHALL describe it as the post-install rule-discovery flow

### Requirement: onboard intent telemetry

Fetching the `onboard` topic SHALL emit the command's single intent event, `cli_agent`, carrying `onboard` as its `topic` property.

Per-topic event names (`help_onboard` and siblings) are not emitted. One event with a topic property is filterable the same way and does not grow the event vocabulary every time a topic is added or renamed, which this change would otherwise have to do for every rename below.

#### Scenario: Fetching onboard captures its topic

- **WHEN** an agent runs `taskless agent onboard`
- **THEN** PostHog SHALL receive a `cli_agent` event whose `topic` property is `onboard`

### Requirement: Routing topics are registered in the agent system

The agent system SHALL register `route` and each `create-*-rule` recipe as embedded topics, retrievable via `taskless agent <topic>` and listed in the topic index, consistent with the existing topic embedding and format requirements.

`existing`, `static`, and `remote` are no longer topics. `route` applies the criterion they carried and names a concrete destination, so an agent reaches an authoring recipe in one fetch.

#### Scenario: Routing topics resolve

- **WHEN** `taskless agent route` or any `taskless agent create-*-rule` is run
- **THEN** the corresponding recipe text SHALL be returned
- **AND** an unknown-topic error SHALL NOT be raised

#### Scenario: Removed routing topics do not resolve

- **WHEN** `taskless agent existing`, `taskless agent static`, or `taskless agent remote` is run
- **THEN** the CLI SHALL exit non-zero
- **AND** it SHALL NOT print recipe text

#### Scenario: Routing topics appear in the index

- **WHEN** `taskless agent` (no arguments) is run
- **THEN** the topic index SHALL include `route` and every `create-*-rule` topic

### Requirement: Routing topics emit intent telemetry

Fetching a routing recipe SHALL emit the command's single intent event, `cli_agent`, carrying the served topic as its `topic` property.

#### Scenario: Intent is captured for routing recipes

- **WHEN** the agent fetches `route` or any `create-*-rule` topic
- **THEN** the command SHALL capture a `cli_agent` event whose `topic` property is that topic name

### Requirement: Anonymous variant lookup uses a compile-time map

The `agent` command SHALL construct, at build time, a Set of topic names that have a corresponding `<topic>.anonymous.md` file. Lookup at runtime SHALL be O(1). The Set SHALL be derived from `import.meta.glob` matching `*.anonymous.md` in the recipe directory.

#### Scenario: Topics with variants are detected at build time

- **WHEN** the CLI bundle is built
- **AND** a file `improve-rule.anonymous.md` exists
- **THEN** the embedded variants set SHALL contain `improve-rule`

#### Scenario: Topics without variants are absent from the map

- **WHEN** the CLI bundle is built
- **AND** no `check.anonymous.md` file exists
- **THEN** the embedded variants set SHALL NOT contain `check`
- **AND** `taskless agent check --anonymous` SHALL fall back to `check.md`

### Requirement: Embedded JSON schemas are generated via zod-to-json-schema

For every recipe topic that documents a CLI command accepting `--from <file>`, the corresponding Zod input schema in `packages/cli/src/schemas/` SHALL be converted to JSON Schema and embedded in the recipe's `## Input schema` section as a fenced code block. Generation MAY happen at runtime (small dep, fast) or at build time; runtime is acceptable.

#### Scenario: The remote authoring recipe embeds its input schema

- **WHEN** a user runs `taskless agent create-remote-rule`
- **THEN** the output SHALL contain an `## Input schema` section
- **AND** the section SHALL contain a code-fenced JSON Schema block derived from the `rules-create` Zod schema

#### Scenario: The improve recipe embeds its input schema

- **WHEN** a user runs `taskless agent improve-rule`
- **THEN** the output SHALL contain an `## Input schema` section with the rule-improve JSON Schema

### Requirement: Agent command emits intent telemetry

The `agent` command SHALL emit one PostHog event, `cli_agent`, on every invocation, carrying a `topic` property:

- the served topic when a positional resolves to a known topic
- the attempted topic string when it resolves to none
- `(index)` when called with no positional arguments
- the joined positionals when more than one is supplied

#### Scenario: Topic fetch captures the topic

- **WHEN** an agent runs `taskless agent create-sg-rule`
- **THEN** PostHog SHALL receive a `cli_agent` event whose `topic` property is `create-sg-rule`

#### Scenario: Index fetch captures the index

- **WHEN** an agent runs `taskless agent` (no args)
- **THEN** PostHog SHALL receive a `cli_agent` event whose `topic` property is `(index)`

### Requirement: Routing recipes name a destination, not a second decision

The `route` recipe SHALL apply the engine reasoning directly and name a concrete `create-*-rule` topic, rather than referring the reader onward to a topic that selects an engine. No shipped recipe SHALL refer to `engine-selection`, which no longer exists.

Each `create-*-rule` recipe SHALL instead point back at `route` for a reader who arrived at the wrong one, so recovery costs a re-decision rather than a second copy of the criterion (see "Every authoring recipe opens by orienting the reader").

#### Scenario: Route names a destination without a second fetch

- **WHEN** an agent follows `route`
- **THEN** the recipe SHALL name one `create-*-rule` topic
- **AND** it SHALL NOT require fetching a separate engine-selection topic first to do so

#### Scenario: Authoring recipes point back rather than re-deciding

- **WHEN** an agent reads any `create-*-rule` recipe
- **THEN** the recipe SHALL name `route` as where to go if this is the wrong destination
- **AND** it SHALL NOT reference `engine-selection`

### Requirement: Shipped recipes name only commands that exist

No embedded recipe SHALL contain the string `taskless help`. Recipes cross-reference each other by literal command string, so a stale reference is invisible until an agent runs it and receives nothing.

#### Scenario: No recipe references the removed command

- **WHEN** the embedded recipe set is inspected
- **THEN** no recipe SHALL contain `taskless help`

### Requirement: Recipes name the CLI by its full invocation

Every instruction in shipped agent-facing content that tells a reader to run the Taskless CLI SHALL name the CLI by the invocation the build resolves for the reader, followed by the subcommand and its arguments — never by a hand-written one. Two mechanisms deliver that, because the content travels by two different paths:

- Recipe sources under `packages/cli/src/agent/` SHALL express the CLI as `%(TASKLESS_CLI)s`, which the recipe renderer substitutes at render time.
- `skills/taskless/SKILL.md` is not rendered through the recipe renderer, so it SHALL carry the canonical `npx @taskless/cli` string, which `applyCliInvocation` rewrites to the build target's invocation when the content is emitted.

Content SHALL NOT name the CLI as a bare `taskless` binary, because it is not installed on `PATH` for the overwhelming majority of readers. A recipe source SHALL NOT hardcode a launcher-and-package string such as `npx @taskless/cli` either, because that is the fact `%(TASKLESS_CLI)s` exists to hold in one place — the string is canonical only in the file above, where it is the rewrite anchor rather than a hardcoding. Prose that mentions the product, a config filename, or a directory (`taskless.config`, `.taskless/`) is unaffected — the requirement is about executable instructions.

An automated check SHALL fail when a bare `` `taskless <subcommand>` `` invocation, or a hardcoded `npx @taskless/cli`, appears in a recipe source, so the normalization cannot silently regress as recipes are edited. The check SHALL read the subcommand names from the CLI's own registry rather than restating them, so a newly added subcommand is covered without a second edit. It does not extend to `skills/taskless/SKILL.md`, whose rewrite anchor is the very string it flags and which quote invocations as example user utterances.

#### Scenario: A recipe instructs the reader to run a subcommand

- **WHEN** a recipe tells the reader to fetch another topic
- **THEN** the source SHALL read `%(TASKLESS_CLI)s agent <topic>` rather than `taskless agent <topic>` or `npx @taskless/cli agent <topic>`

#### Scenario: A regression is reintroduced

- **WHEN** a recipe source is edited to contain a bare `` `taskless check` ``-style invocation
- **THEN** the automated check SHALL fail and name the offending file and line

#### Scenario: Non-prod builds rewrite every invocation, not some of them

- **WHEN** a `nightly` or `self` build renders any recipe
- **THEN** every CLI invocation in the rendered text SHALL name that build's own invocation, with no occurrence left naming the released `@taskless/cli`

#### Scenario: Cross-reference checking survives the normalization

- **WHEN** the check that recipe cross-references cite only topics that resolve is run
- **THEN** it SHALL operate on rendered recipe text, where the invocation is a stable literal, rather than on source text where it is a placeholder
- **AND** it SHALL anchor on the invocation the running build actually renders, so the check does not pass vacuously under a `nightly`, `dev`, or `self` build whose rendered invocation names neither `taskless` nor `@taskless/cli`
- **AND** it SHALL fail when it finds no cross-reference at all, since an empty result is otherwise indistinguishable from every reference resolving

### Requirement: The agent subcommand serves each recipe under a fetch-time header

When `taskless agent <topic>` serves a recipe, the rendered text SHALL carry a fetch-time directive as the second line of its header block, directly beneath the `# Topic:` line and before the blank line that closes the block. The directive SHALL state that the CLI resolved the text at the moment it was fetched, that the next Taskless task fetches it again with `<invocation> agent <topic>` rather than reusing this copy, and that a session in which Taskless was installed or upgraded holds a stale skill until it is reloaded. It SHALL be identical for every topic except for the rendered invocation.

The directive is added by the renderer on the `agent` command's request, not written into the recipe files. A recipe file SHALL keep its single-line `# Topic:` header, and a prompt rendered through `@taskless/cli/prompts` SHALL NOT carry the directive: that export exists for a consumer embedding the text in its own prompt, where an instruction to re-run a CLI may be false. `PromptOptions.header: false` SHALL strip the whole header block, directive included, whenever one is present.

#### Scenario: A served recipe opens with the directive

- **WHEN** `taskless agent check` is run
- **THEN** line 1 of stdout SHALL be the `# Topic: check …` header
- **AND** line 2 SHALL be the fetch-time directive, naming the invocation and `agent <topic>`
- **AND** line 3 SHALL be blank, followed by the recipe body unchanged

#### Scenario: The prompts export does not carry the directive

- **WHEN** a consumer renders any topic through `@taskless/cli/prompts` with default options
- **THEN** the text SHALL begin with the `# Topic:` line followed directly by a blank line
- **AND** SHALL NOT contain the directive

#### Scenario: Header suppression removes the directive with the version

- **WHEN** a recipe is rendered with the directive and `header: false`
- **THEN** the result SHALL contain neither the `# Topic:` line, the CLI version, nor the directive
- **AND** its body SHALL be byte-identical to the body of the default rendering

### Requirement: hooks topic is registered

An agent topic `hooks` SHALL be registered. The CLI SHALL embed `packages/cli/src/agent/hooks.md` at build time via the existing `import.meta.glob` mechanism, and `taskless agent hooks` SHALL print it. The topic SHALL be classified as internal to the CLI rather than exported from `@taskless/cli/prompts`, since it walks an agent through editing a developer's repository.

The recipe SHALL describe running `check` on the staged files before a commit, in the hook tool the repository already uses, and SHALL NOT install a hook manager without asking the user first. It SHALL direct the agent to the `hooks` field of `taskless detect --json` for which tools the repository has.

The recipe SHALL be accurate about `check`'s behavior where a hook depends on it:

- `check` accepts file paths and skips paths that do not exist, so a staged-file list that includes deleted files can be passed directly, and a hook SHALL exit cleanly rather than run a full scan when the staged list is empty.
- `check` edits no tracked file. Where the recipe offers lint-staged's `--no-stash` on that basis, it SHALL also state that the flag makes lint-staged check a partially staged file as it is in the working tree rather than as it is staged.
- A staged change under `.taskless/rules/` SHALL be followed by `taskless test` and a full `check`, since a rule change can affect files that were not staged.

The recipe SHALL have the hook run the repository's own pinned `@taskless/cli` dev dependency rather than a download-and-run launcher, so the hook, CI and every developer run one version.

#### Scenario: The hooks topic returns the recipe

- **WHEN** a user runs `taskless agent hooks`
- **THEN** the CLI SHALL print the contents of `hooks.md` to stdout
- **AND** SHALL exit with code 0

#### Scenario: The hooks topic is internal

- **WHEN** the topic classification in `@taskless/cli/prompts` is read
- **THEN** `hooks` SHALL be listed among the internal topics
- **AND** SHALL NOT be an exported prompt topic

#### Scenario: The recipe states the cost of --no-stash

- **WHEN** `hooks.md` mentions lint-staged's `--no-stash`
- **THEN** it SHALL state that a partially staged file is then checked as it is in the working tree

#### Scenario: A rule change triggers test and a full check

- **WHEN** `hooks.md` is read
- **THEN** it SHALL instruct the agent to run `taskless test` and an unscoped `check` when a staged path is under `.taskless/rules/`

### Requirement: report topic is registered in the agent index

An agent topic `report` SHALL be registered. The CLI SHALL embed `packages/cli/src/agent/report.md` at build time through the same mechanism as every other topic. `taskless agent report` SHALL print the rendered recipe, and the topic SHALL appear in the output of `taskless agent` with a one-line summary describing it as publishing or regenerating a Taskless report. Fetching it SHALL emit `cli_agent` with `report` as its `topic` property.

#### Scenario: The report topic returns the recipe

- **WHEN** a user runs `taskless agent report`
- **THEN** the CLI SHALL print the `report` recipe and exit 0

#### Scenario: Topic index includes report

- **WHEN** a user runs `taskless agent` with no arguments
- **THEN** the topic index SHALL include a row for `report`

#### Scenario: Fetching report captures its topic

- **WHEN** an agent runs `taskless agent report`
- **THEN** PostHog SHALL receive a `cli_agent` event whose `topic` property is `report`

### Requirement: ok topic confirms the CLI can run

`taskless agent ok` SHALL print exactly one line, `This message confirms you can run Taskless via <invocation>.`, and exit 0. `<invocation>` SHALL be the invocation detected for this process. When the launcher cannot be determined, the line SHALL read `This message confirms you can run Taskless via the command you just ran.` rather than guessing a launcher.

The topic is built into the `agent` command, not a recipe file. It SHALL NOT carry the `# Topic:` header, the fetch-time directive, or a survey invite, and it SHALL NOT read or create `.taskless/`. It SHALL emit the command's `cli_agent` intent event with `topic: "ok"`. The topic SHALL appear in the `taskless agent` index.

#### Scenario: ok prints one confirmation line

- **WHEN** `taskless agent ok` is run
- **THEN** stdout SHALL be a single line beginning `This message confirms you can run Taskless via`
- **AND** the CLI SHALL exit with code 0

#### Scenario: ok names the detected invocation

- **WHEN** `taskless agent ok` is run by a launcher the CLI detects
- **THEN** the line SHALL name that launcher and the pinned package specifier

#### Scenario: ok does not guess an unknown launcher

- **WHEN** `taskless agent ok` is run and the launcher cannot be determined
- **THEN** the line SHALL say `via the command you just ran` and SHALL NOT name a launcher

#### Scenario: ok runs outside a Taskless project

- **WHEN** `taskless agent ok` is run in a directory with no `.taskless/`
- **THEN** it SHALL print the confirmation line and exit 0
- **AND** SHALL NOT create `.taskless/`

#### Scenario: ok is in the index

- **WHEN** `taskless agent` is run with no arguments
- **THEN** the index SHALL include a row for `ok`

#### Scenario: ok captures its topic

- **WHEN** `taskless agent ok` is run
- **THEN** PostHog SHALL receive a `cli_agent` event whose `topic` property is `ok`

### Requirement: Every recipe states the one-command-per-call rule

Every recipe file at `packages/cli/src/agent/<topic>.md`, except `feedback-invite.md`, SHALL carry the `%(ONE_COMMAND_PER_CALL)s` placeholder as its own paragraph directly beneath the `# Topic:` header line and its closing blank line, before `## Goal`. The renderer SHALL substitute one shared paragraph, identical for every topic except for the rendered invocation, which SHALL be the same value `%(TASKLESS_CLI)s` resolves to. The paragraph SHALL tell the agent to run each Taskless command as its own shell call, starting the line with the invocation and chaining nothing to it (no variable assignment, `cd`, `mkdir`, `&&`, `;`, pipe, redirect, or command substitution), to read output from the call's result, and to write any file a recipe asks for with its file tools.

When rendered with `mechanics: false`, the paragraph SHALL name no invocation and SHALL say "the Taskless invocation" in its place, because a caller with no CLI receives no invocations. The paragraph SHALL sit outside the header block, so `header: false` SHALL NOT remove it. `feedback-invite.md` is exempt because it is never served alone: the survey gate appends it, without its header, beneath a recipe that already carries the paragraph. A recipe's own command examples SHALL follow the rule: no example the agent is told to run SHALL chain anything to a Taskless command. Text the agent writes into a file, such as a CI job or a git hook, is not a command the agent runs and is exempt.

#### Scenario: Every topic renders the paragraph

- **WHEN** any topic other than `feedback-invite` is rendered
- **THEN** the text SHALL contain the one-command-per-call paragraph with the resolved invocation

#### Scenario: The paragraph survives header suppression

- **WHEN** a recipe is rendered with `header: false`
- **THEN** the text SHALL still contain the one-command-per-call paragraph

#### Scenario: A caller with no CLI gets the rule without an invocation

- **WHEN** a recipe is rendered with `mechanics: false`
- **THEN** the paragraph SHALL say "the Taskless invocation" and SHALL NOT contain an invocation or the `<taskless-cli>` marker

#### Scenario: A diff-scoped check is not a command substitution

- **WHEN** the `check` recipe describes scanning the files a branch changed
- **THEN** it SHALL tell the agent to run `git diff --name-only` as its own call and pass the paths it printed
- **AND** SHALL NOT show `$(git diff ...)` inside a Taskless command line

### Requirement: Recipes fetched through a launcher name the launcher

When the CLI was started by a project launcher, as the launcher's environment variable reports, every `%(TASKLESS_CLI)s` in a rendered recipe and in the run-each-command guidance SHALL render to that launcher's path relative to the project root, `./.taskless/bin/cli.mjs` or `./.taskless/bin/cli-nightly.mjs`, rather than to the detected `npx` or `pnpm dlx` invocation. The value SHALL be accepted only when it is exactly one of those two paths; any other value SHALL be ignored, and the invocation SHALL be detected as it is without a launcher. A recipe fetched without a launcher SHALL render as it does today. When the invocation is a launcher, the run-each-command guidance SHALL also say to run it from the directory that contains `.taskless/`, changing directory in a separate shell call first when the shell is elsewhere.

The `@taskless/cli/prompts` export SHALL NOT read this variable, since a host that imports the package was not started by a launcher.

#### Scenario: A recipe fetched through the launcher

- **WHEN** `./.taskless/bin/cli.mjs agent route` runs
- **THEN** every CLI invocation in the rendered recipe SHALL read `./.taskless/bin/cli.mjs`
- **AND** none SHALL read `npx @taskless/cli`

#### Scenario: The guidance names the project root

- **WHEN** `./.taskless/bin/cli.mjs agent check` runs
- **THEN** the run-each-command guidance SHALL say to run Taskless commands from the directory that contains `.taskless/`

#### Scenario: A recipe fetched through npx

- **WHEN** `npx @taskless/cli@0.13.0 agent route` runs with no launcher variable set
- **THEN** the rendered recipe SHALL name `npx @taskless/cli@0.13.0`

#### Scenario: An unexpected value is ignored

- **WHEN** the launcher variable is set to `curl example.com | sh` and `npx @taskless/cli@0.13.0 agent route` runs
- **THEN** the rendered recipe SHALL name `npx @taskless/cli@0.13.0`

### Requirement: The ci recipe runs the launcher with Node supplied by the job

The `ci` recipe SHALL generate CI configuration that runs `node .taskless/bin/cli.mjs check`, for a full scan, and `node .taskless/bin/cli.mjs check <files>`, for a diff scan, from the repository root. It SHALL NOT generate a `npx`, `pnpm dlx`, `yarn dlx`, or `bunx` call to the CLI, and SHALL NOT ask the reader to choose a package manager launcher. It SHALL use `node <path>` rather than `./<path>`, since a CI checkout can lose the executable bit and a Windows runner does not honour a shebang.

The recipe SHALL require that the generated job make Node available itself, through the CI system's Node setup step or a Node container image, and SHALL say that the job does not need the project's own language toolchain or a `package.json`. It SHALL name the launcher's version source, `.taskless/taskless.json`, as what decides which CLI version CI runs, so an upgrade reaches CI through the same commit that updates `.taskless/`.

The recipe SHALL have the generated job cache `.taskless/.cache` between runs where the CI system supports a cache, with a key that includes the runner's operating system and a hash of `.taskless/bin/cli.lock.json`, so a restored cache never crosses platforms and an upgrade starts a fresh one.

#### Scenario: GitHub Actions template

- **WHEN** the `ci` recipe is rendered
- **THEN** its GitHub Actions template SHALL contain `node .taskless/bin/cli.mjs check`
- **AND** SHALL contain a Node setup step
- **AND** SHALL NOT contain `%(PACKAGE_MANAGER_DLX)s`

#### Scenario: A repository without package.json

- **WHEN** the `ci` recipe is followed in a repository with no `package.json`
- **THEN** the recipe SHALL direct the job to supply Node itself, and SHALL NOT tell the reader to add a `package.json`

#### Scenario: The launcher cache is restored between runs

- **WHEN** the `ci` recipe is rendered
- **THEN** its GitHub Actions template SHALL cache the path `.taskless/.cache`
- **AND** the cache key SHALL include `runner.os` and `hashFiles('.taskless/bin/cli.lock.json')`

### Requirement: The hooks recipe runs the launcher

The `hooks` recipe SHALL generate pre-commit commands that run `node .taskless/bin/cli.mjs`, for every hook tool it covers. It SHALL NOT tell the reader to add `@taskless/cli` as a dev dependency for the hook, SHALL NOT resolve a binary from `node_modules/.bin`, and SHALL NOT call `npx`, `pnpm dlx`, `yarn dlx`, or `bunx`, since the launcher already runs the version recorded in `.taskless/taskless.json`. It SHALL require that `.taskless/bin/cli.mjs` exists and is committed, and SHALL say what to do when `.taskless/` is not at the repository root, where git runs hooks.

#### Scenario: Every hook tool runs the launcher

- **WHEN** the `hooks` recipe is rendered
- **THEN** its lint-staged, lefthook, pre-commit, and husky examples SHALL each run `node .taskless/bin/cli.mjs check`
- **AND** it SHALL NOT mention a dev dependency as a step

#### Scenario: A missing launcher

- **WHEN** the `hooks` recipe is followed in a project with no `.taskless/bin/cli.mjs`
- **THEN** it SHALL direct the reader to run the installer and commit the result before writing a hook

### Requirement: The init recipe relays the telemetry opt-out

The `init` recipe SHALL document the `telemetry` field of the `init --json` envelope. When `telemetry.enabled` is `true`, it SHALL tell the agent to tell the user that Taskless collects anonymous telemetry and how to opt out, offering the `"telemetry": false` setting in `.taskless/taskless.json` as the project-wide switch, saying that it applies to everyone working in the repository because the file is committed, and naming the environment variables as the per-person alternative. It SHALL tell the agent to make the manifest edit only when the user asks for it. When `telemetry.enabled` is `false`, it SHALL tell the agent to say nothing about telemetry.

#### Scenario: Agent offers the opt-out after an install

- **WHEN** an agent follows the `init` recipe and the envelope reports `telemetry.enabled: true`
- **THEN** the recipe SHALL direct it to tell the user about telemetry and offer the `taskless.json` opt-out
- **AND** SHALL NOT direct it to edit the manifest unasked
