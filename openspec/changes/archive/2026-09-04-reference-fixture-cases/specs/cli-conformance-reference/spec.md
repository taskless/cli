## ADDED Requirements

### Requirement: The CLI publishes a conformance corpus

The CLI SHALL publish `assets/reference.json` as the package export
`@taskless/cli/reference.json`, carrying a `version`, the `protocol` the corpus
exists to support, the `constraints` `verify` and `test` enforce beyond an
engine's own schema, and one entry per shipped demonstration rule.

The corpus SHALL be built from the shipped rules rather than restating them, so
what another team grades against and what the CLI writes into a project cannot
come to describe different things.

`version` SHALL be incremented whenever a consumer would have to change code to
keep reading the artifact. A consumer that asserts the version and stops is
behaving correctly, so the bump is the only signal the corpus owes it.

#### Scenario: The corpus is reachable as a published export

- **WHEN** the package is installed from the registry
- **THEN** `assets/reference.json` SHALL be among the published files
- **AND** the export map SHALL name `./reference.json`

#### Scenario: The corpus separates the rule from its cases

- **WHEN** a consumer reads a corpus entry
- **THEN** the files a generator must produce SHALL be carried apart from the cases both sides' rules must satisfy
- **AND** no file SHALL appear in both

### Requirement: The corpus states how its fixtures group into cases

Each corpus entry's `tests` SHALL carry a `grouping` field naming how its fixture
files group into cases, the flat list of fixture files with their contents, and
— where the grouping is the CLI's own — an explicit list of cases.

A consumer SHALL be able to recover which files belong to which case by reading
published fields alone. Deriving it from path prefixes requires knowing that a
`runtime` case is a directory and a `vale` case is a document, which is a fact
about the CLI's layout that every consumer would otherwise transcribe, and a
transcribed fact goes stale silently when the layout changes.

Each case SHALL name the `bucket` it asserts (`pass` or `fail`), its own `name`,
the `path` the engine is pointed at, and the fixture files it holds. Case files
SHALL be named by path rather than by repeated content, and every such path
SHALL resolve to an entry in the same `tests.files` list.

`bucket` SHALL be spelled `pass`/`fail`, matching the directories the CLI reads,
rather than an individual engine's vocabulary.

#### Scenario: A runtime case is a directory of files

- **WHEN** a consumer reads the `runtime` entry
- **THEN** `grouping` SHALL be `case-directories`
- **AND** each case SHALL name the directory the check is handed as its root
- **AND** a case whose evidence spans two files SHALL list both

#### Scenario: A vale case is one document

- **WHEN** a consumer reads the `vale` entry
- **THEN** `grouping` SHALL be `case-documents`
- **AND** each case SHALL name the document and hold exactly that one file

#### Scenario: An ast-grep entry says its grouping is not the CLI's

- **WHEN** a consumer reads the `sg` entry
- **THEN** `grouping` SHALL be `ast-grep-test`
- **AND** the ast-grep test file SHALL be carried whole
- **AND** no case list SHALL be published, because the grouping inside that file belongs to ast-grep's own documented schema rather than to the CLI

#### Scenario: Every case file resolves

- **WHEN** the corpus is generated
- **THEN** every path a case names SHALL appear in that entry's `tests.files`
- **AND** every file in `tests.files` SHALL belong to exactly one case, where a case list is published

### Requirement: The corpus states where a rule lives

The corpus SHALL publish the rule layout: the root every rule hangs off, the
directory pattern a rule of a given engine and id occupies, the tests directory
name, and per engine which file is the rule, which is its engine config, and
where its capture rules live.

Each entry SHALL additionally carry its own resolved rule directory and rule
file, so a consumer materializing the three rules in the corpus performs no
substitution at all, while a consumer placing a rule the corpus does not contain
has the pattern to place it by.

Every value SHALL be derived from the same table the CLI dispatches on, so the
corpus cannot describe a layout the CLI does not implement.

The corpus SHALL NOT publish file paths relative to a root it does not name. A
consumer that has to assume where the CLI looks is transcribing a fact about the
CLI, which is the failure this corpus exists to remove.

#### Scenario: A consumer places a rule the corpus does not contain

- **WHEN** a consumer generates its own rule for an engine and id
- **THEN** the corpus SHALL state the directory pattern that rule occupies
- **AND** it SHALL state which file inside that directory is the rule for that engine

#### Scenario: The published layout matches the table the CLI dispatches on

- **WHEN** the corpus is generated
- **THEN** the published layout SHALL agree with the CLI's own engine layout table
- **AND** each entry's resolved directory SHALL be the directory the CLI resolves for that engine and id

### Requirement: The corpus publishes what verify enforces beyond the engine

The corpus SHALL carry every entry in `RULE_CONSTRAINTS`, each with a stable
`id`, the `engine` it applies to, which command enforces it, a summary, and the
rationale behind it.

Published because a generator that never reads the CLI's recipes cannot know
these, and because without the list a refusal is indistinguishable from a
disagreement about the subject the rule addresses.

#### Scenario: A constraint says which command enforces it

- **WHEN** a consumer plans the order of an evaluation
- **THEN** each constraint SHALL state whether `verify` or `test` refuses the rule
