## MODIFIED Requirements

### Requirement: Runtime rules are directories recognized by metadata

The CLI SHALL recognize a **runtime rule** as a directory under `.taskless/rules/runtime/<id>/`
containing a `captures/` directory of one or more ast-grep capture `*.yml` (one per capture rule)
and a single `check.ts`, its capture rules declaring `metadata.taskless.kind: runtime`. The rule's
check file SHALL be the `check.ts` in the rule directory. The CLI SHALL read **each capture rule's**
`metadata.taskless.match` to select that capture rule's ast-grep invocation mode; capture rules
within one runtime rule MAY mix modes (each is independent).

A `match` value the build does not implement SHALL be **refused**, never coerced to a default. The
modes scan different things — `anchor` is a syntactic narrow, `broad` a whole-language enumerator —
so substituting one for another reinterprets the capture rather than degrading it, and the shortfall
would be reported as a clean pass. The refusal SHALL be per capture file, not per rule, so one
unimplemented mode does not remove a rule's other narrows.

Rule files under `.taskless/rules/sg/` SHALL continue to be treated as static ast-grep rules,
not runtime rules. A rule's `.tests/` directory holds verification fixtures and SHALL NOT be
executed by `check`.

#### Scenario: A runtime directory entry is a runtime rule

- **WHEN** `.taskless/rules/runtime/<id>/captures/` contains `*.yml` with `metadata.taskless.kind: runtime` and the directory has a `check.ts`
- **THEN** the CLI SHALL treat it as a runtime rule with `check.ts` as its check file and route it to the runtime harness

#### Scenario: Rules under sg remain static

- **WHEN** a rule file lives under `.taskless/rules/sg/`
- **THEN** the CLI SHALL treat it as a static rule and SHALL NOT route it to the runtime harness

#### Scenario: An unimplemented match mode is refused

- **WHEN** a capture rule declares a `match` value this build does not implement
- **THEN** the CLI SHALL NOT load that capture rule
- **AND** SHALL NOT treat it as `anchor`
- **AND** the rule's other capture rules SHALL still load

#### Scenario: verify explains a refused capture

- **WHEN** `taskless verify` inspects a rule holding a capture with an unimplemented `match` value
- **THEN** verification SHALL fail
- **AND** the error SHALL name the capture file, the offending value, and the modes this build implements

## ADDED Requirements

### Requirement: A runtime rule has exactly one executable file

The CLI SHALL refuse a runtime rule whose directory contains any module file other than
`check.ts`. `check.ts` is the only executable surface of a runtime rule and the only artifact
carrying a signature, so any other module would be code reachable from a blessed entry point
without itself being blessed — one relative import away, while tampering with it leaves
`check.ts` still matching its blessed digest. The generator commits to emitting exactly one;
this requirement makes the guarantee enforced rather than trusted.

"Module file" SHALL cover every extension a check could import, not only `.ts`: the loader
transpiles TypeScript, but a `.js` sibling resolves just as readily.

The search SHALL be recursive. "One import away" is not "one directory away" — a single
`import "./lib/helper.ts"` reaches an arbitrarily deep relative path in one hop — so a search
bounded to the rule root would let any nested directory carry unsigned code past the check while
`check.ts` still matched its blessed signature. The search SHALL also consider only files, so a
directory whose name ends in a module extension is not reported as one.

The rule's `.tests/` directory SHALL be excluded from this search. A runtime check reads real
files under a root, so a fixture that is itself TypeScript is the normal case rather than a
smuggled helper, and refusing it would break correct rules — a worse failure than the one being
prevented.

#### Scenario: A helper module beside check.ts is refused

- **WHEN** a runtime rule directory contains `check.ts` and any other module file, at any depth
- **THEN** the CLI SHALL refuse the rule and name the offending file
- **AND** SHALL NOT execute its `check.ts`

#### Scenario: A TypeScript test fixture is not a stray module

- **WHEN** a runtime rule carries a `.ts` file under its `.tests/` directory
- **THEN** the CLI SHALL still discover and run the rule

### Requirement: Declared versions are read

The CLI SHALL read `RUNTIME_CHECK_PROTOCOL_VERSION` against a delivered check's declared protocol
version, and `metadata.taskless.version` on a capture rule, refusing what it does not implement.
Both values exist today and are read by nothing, so a payload declaring a future contract is
executed against the current one.

#### Scenario: A future protocol version is refused

- **WHEN** a runtime rule declares a check protocol version this build does not implement
- **THEN** the CLI SHALL refuse the rule and state the version it expected
- **AND** SHALL NOT invoke the check with the current argument shape
