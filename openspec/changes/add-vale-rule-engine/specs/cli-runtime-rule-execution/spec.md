## MODIFIED Requirements

### Requirement: Runtime rules are directories recognized by metadata

The CLI SHALL recognize a **runtime rule** as a directory under `.taskless/runtime/rules/<name>/`
containing one or more ast-grep capture `*.yml` (one per capture rule) and a single `check.ts`,
its capture rules declaring `metadata.taskless.kind: runtime`. The rule's check file SHALL be
the `check.ts` in the rule directory. The CLI SHALL read **each capture rule's**
`metadata.taskless.match` (`anchor` or `broad`) to select that capture rule's ast-grep
invocation mode; capture rules within one runtime rule MAY mix modes (each is independent).
Rule files under `.taskless/sg/rules/` SHALL continue to be treated as static ast-grep rules,
not runtime rules. `.taskless/runtime/rule-tests/<name>/` holds `valid/` and `invalid/`
verification fixtures and SHALL NOT be executed by `check`.

#### Scenario: A runtime directory entry is a runtime rule

- **WHEN** `.taskless/runtime/rules/<name>/` contains capture `*.yml` with `metadata.taskless.kind: runtime` and a `check.ts`
- **THEN** the CLI SHALL treat it as a runtime rule with `check.ts` as its check file and route it to the runtime harness

#### Scenario: Rules under sg remain static

- **WHEN** a rule file lives under `.taskless/sg/rules/`
- **THEN** the CLI SHALL treat it as a static rule and SHALL NOT route it to the runtime harness
