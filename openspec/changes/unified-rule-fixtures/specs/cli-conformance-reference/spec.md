## REMOVED Requirements

### Requirement: The corpus states how its fixtures group into cases

**Reason**: Its scenarios publish three groupings (`case-directories`, `case-documents` and `ast-grep-test`), and two of them describe layouts that no longer exist. Under `cli-rule-fixtures` every engine's case is a directory. A MODIFIED block could not drop those scenarios, and keeping them under the old title would leave the spec saying a Vale case is one document.

**Migration**: Replaced by "The corpus publishes every engine's fixtures as case directories" below. The `grouping` field stays, and its only value is `case-directories`. The corpus `version` increments, because `tests.files` paths change prefix and the `sg` entry gains a case list.

## ADDED Requirements

### Requirement: The corpus publishes every engine's fixtures as case directories

Each corpus entry's `tests` SHALL carry a `grouping` field naming how its fixture
files group into cases, the flat list of fixture files with their contents, and
an explicit list of cases.

A consumer SHALL be able to recover which files belong to which case by reading
published fields alone, so that the case layout stays a published fact and is
not transcribed by every consumer. A transcribed fact goes stale silently when
the layout changes, and this change is such a change.

Every engine SHALL publish `grouping` as `case-directories` with an explicit case
list. The field stays even though it now has one value: a consumer asserts on
it, and it is what a later layout change would move. The `case-documents` and
`ast-grep-test` values SHALL NOT be published, because no engine uses them.

Each case SHALL name the `bucket` it asserts (`pass` or `fail`), its own `name`,
the `path` the engine is pointed at, and the fixture files it holds. Case files
SHALL be named by path rather than by repeated content, and every such path
SHALL resolve to an entry in the same `tests.files` list.

`bucket` SHALL be spelled `pass`/`fail`, matching the directories the CLI reads,
rather than an individual engine's vocabulary.

#### Scenario: Every engine publishes case directories

- **WHEN** a consumer reads the `sg`, `vale`, or `runtime` entry
- **THEN** `grouping` SHALL be `case-directories`
- **AND** each case SHALL name the directory the engine is handed as its root
- **AND** a case whose evidence spans two files SHALL list both

#### Scenario: No engine-native test file is published

- **WHEN** a consumer reads the `sg` entry
- **THEN** its `tests.files` SHALL hold no ast-grep test YAML
- **AND** every file SHALL belong to a published case

#### Scenario: A single-document case is still a directory

- **WHEN** a consumer reads the `vale` entry and a case holds a single document
- **THEN** the case SHALL name its directory as its `path`
- **AND** SHALL list that one document as its file

#### Scenario: Every case file resolves

- **WHEN** the corpus is generated
- **THEN** every path a case names SHALL appear in that entry's `tests.files`
- **AND** every file in `tests.files` SHALL belong to exactly one case
