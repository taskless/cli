# CLI Runtime Rule Execution

## Purpose

Defines how the CLI executes a **runtime rule** in `taskless check`: the on-disk shape it recognizes, the local harness that runs the rule's ast-grep capture narrow and gates on matches, how it invokes the rule's `check.ts` as a function under a bundled TypeScript loader, and how the returned findings map onto the scanner-agnostic result type. A runtime rule's `check.ts` is arbitrary code; the reconciliation gate that authorizes running it is defined in `cli-rule-reconciliation`, and the auth-state dispatch is defined in `cli-check`.

## Requirements

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

### Requirement: The harness narrows with one ast-grep scan and gates on matches

For a runtime rule the CLI SHALL assemble the rule's capture rules into an ast-grep
configuration and run **one scan per mode** as the narrow: `--json=stream` for `anchor` capture
rules, and `--files-with-matches` for `broad` capture rules (whole-language `kind: program`
enumerators). A rule with only `anchor` capture rules therefore runs in a single scan; a rule
mixing modes runs one scan per mode. When the narrow produces **zero** matches the CLI SHALL
NOT invoke `check.ts`.

#### Scenario: Zero matches skips the check

- **WHEN** a runtime rule's narrow scan produces no matches
- **THEN** the CLI SHALL NOT invoke that rule's `check.ts`
- **AND** the rule SHALL contribute no findings

#### Scenario: Capture rules of a mode run together

- **WHEN** a runtime rule has multiple `anchor` capture rules
- **THEN** the CLI SHALL run them in a single `ast-grep` scan, not one scan per capture rule

### Requirement: Matches are normalized and attributed to the model name

The CLI SHALL normalize every narrow match to
`{ rule, ruleId, file, line, column, text, captures }`, where `file` is root-relative, `line`
is 1-indexed, and `rule` is the capture rule's stable model-assigned `name`. The CLI SHALL map
the hashed capture-rule `id` used by the scan back to that `name` so `match.rule` is the value
the check branches on, never the hash. A `broad` (path-only, `--files-with-matches`) match
carries no location or captures: its `line` and `column` SHALL be `1`, and its `text` and
`captures` SHALL be empty.

#### Scenario: Hashed id maps to model name

- **WHEN** the scan emits a match whose rule id is the hashed `${ruleSlug}-${sha1}` identifier
- **THEN** the normalized match's `rule` SHALL be the capture rule's model-assigned `name`

### Requirement: The check is invoked as a function and its return value is used

The CLI SHALL invoke a runtime rule's `check.ts` by calling its **default export** as a
function with `(root, matches)`, where `root` is the repository root and `matches` are the
normalized matches. The CLI SHALL use the `Finding[]` value the function **returns** as the
rule's result; it SHALL NOT infer results from process exit codes or stdout. A `check.ts` that
throws SHALL be isolated to a single error-severity finding for that rule and SHALL NOT abort
the overall `check` run.

#### Scenario: Returned findings are the result

- **WHEN** a runtime rule's `check.ts` default export returns a `Finding[]`
- **THEN** the CLI SHALL treat exactly those findings as the rule's output

#### Scenario: A throwing check is isolated

- **WHEN** a runtime rule's `check.ts` throws during execution
- **THEN** the CLI SHALL record a single error-severity finding for that rule
- **AND** SHALL continue executing the remaining rules and produce output

### Requirement: check.ts execution is bounded by a timeout

The CLI SHALL bound each `check.ts` invocation with a wall-clock timeout and SHALL accept a
`--timeout <seconds>` flag on `check` to override the default. When a `check.ts` exceeds the
timeout the CLI SHALL terminate it, record a single error-severity finding for that rule, and
continue executing the remaining rules — a runaway check SHALL NOT wedge the overall `check`
run.

#### Scenario: A hanging check is terminated at the timeout

- **WHEN** a runtime rule's `check.ts` runs longer than the effective timeout
- **THEN** the CLI SHALL terminate it and record a single error-severity finding for that rule
- **AND** SHALL continue executing the remaining rules

#### Scenario: --timeout overrides the default

- **WHEN** a user runs `taskless check --timeout <seconds>`
- **THEN** the CLI SHALL use that value as the per-check wall-clock bound

### Requirement: check.ts runs via a bundled TypeScript loader

The CLI SHALL execute `check.ts` using a pinned TypeScript loader bundled with the CLI (e.g.
`tsx`) and SHALL NOT require the user's repository to provide a TypeScript toolchain,
`node_modules`, or a precompile step. The CLI MAY schedule invocations by any mechanism
(process-per-check, worker pool, or in-process import); the function contract does not
constrain the choice.

#### Scenario: No user toolchain required

- **WHEN** a repository with a runtime rule has no local TypeScript toolchain installed
- **THEN** the CLI SHALL still execute the rule's `check.ts` using its bundled loader

### Requirement: Findings map onto the scanner-agnostic result type

The CLI SHALL map each `Finding` returned by a `check.ts` onto the existing `CheckResult`
shape with a runtime `source`, so runtime findings are aggregated, formatted, and counted
toward the exit code identically to static findings. `Finding.severity` (`error` / `warning` /
`info`) SHALL map directly onto the corresponding `CheckResult` severity with no translation.

#### Scenario: Runtime findings gate the exit code like static findings

- **WHEN** a runtime rule returns a finding with `severity: "error"`
- **THEN** the CLI SHALL count it toward the error total that sets a non-zero exit code
- **AND** the finding SHALL appear in `--json` output under the same `results` shape as a static finding

### Requirement: Blessed runtime rules execute from the materialized run directory

When a runtime rule is executed on a validated path, the CLI SHALL execute it from the
ephemeral, gitignored `.taskless/.run/` materialization of the blessed bytes, not from the
live `.taskless/rules/runtime/` tree, so the bytes executed are the exact bytes reconciliation
blessed (read-hash-execute ordering).

#### Scenario: Execution uses the blessed bytes

- **WHEN** a runtime rule is blessed and executed
- **THEN** the CLI SHALL invoke the `check.ts` materialized under `.taskless/.run/`
- **AND** SHALL NOT execute a copy modified in `.taskless/rules/runtime/` after reconciliation

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

### Requirement: A runtime rule's fixtures are executed through the harness

The CLI SHALL execute a runtime rule against the fixture cases it holds under
`.tests/pass/` and `.tests/fail/`. A case SHALL be a **directory**, and that
directory SHALL be the `root` the harness passes to the check.

Each bucket SHALL be read one level deep. An entry that is not a directory SHALL
be an error naming the path, not an ignored entry. Buckets SHALL be read
independently, and a bucket that cannot be read SHALL be an error rather than an
empty bucket.

**Rationale.** A check is a function over a root and its matches, reading
whatever files under that root it needs, so a case has to be a directory: a
runtime rule exists because its evidence spans more than one file, and a
one-file-per-case layout could not express the rules the tier is for. The
strictness on reading is the Vale runner's, for its reason — a swallowed
permission error on one bucket makes a two-sided rule look one-sided, and a
one-sided rule look complete.

#### Scenario: A case directory is the harness root

- **WHEN** a runtime rule's fixture case is executed
- **THEN** the check SHALL receive that case's directory as its `root`
- **AND** SHALL resolve the files it reads beneath that root

#### Scenario: A loose file in a bucket is refused

- **WHEN** a fixture bucket contains an entry that is not a directory
- **THEN** the CLI SHALL report an error naming that path
- **AND** SHALL NOT silently skip it

#### Scenario: An unreadable bucket is not an empty bucket

- **WHEN** a fixture bucket exists but cannot be read
- **THEN** the CLI SHALL report the failure
- **AND** SHALL NOT treat the bucket as holding no cases

### Requirement: Fixture execution is gated on the escape flag alone

Executing a fixture case SHALL require `--dangerously-run-scripts`, and SHALL be
permitted under no other mechanism. No rule identifier SHALL be exempt, and a
blessed signature SHALL NOT substitute for the flag. Deciding this SHALL NOT
involve the rule service: no token SHALL be read, no organization resolved, and
no reconcile performed.

**Rationale.** That the input is test data is a statement about the input, not
about what the program may do, so the fixture path SHALL NOT be a softer gate
than the scan path. It is a stricter one, and for a reason that is about consent
rather than about the bytes. A scan executes rules as a **side effect** of a
request for a report, so a gate has to stand between the two or code runs
silently; that gate is what a reconcile serves. Running fixtures is the request
itself, so the verb is the consent and the flag is the confirmation.

Reconciling here would also buy nothing. The only rule it could ever admit is
one the service already verified before delivering it, while a locally authored
rule has no signature and never will — so for the audience that runs fixtures it
is a network round trip whose answer is always "no".

#### Scenario: Fixtures do not run without the flag

- **WHEN** `test` runs against a runtime rule without `--dangerously-run-scripts`
- **THEN** no fixture case SHALL be executed
- **AND** this SHALL hold irrespective of authentication state or any signature the rule carries

#### Scenario: The documented escape runs fixtures

- **WHEN** `test` runs with `--dangerously-run-scripts`
- **THEN** fixture cases SHALL execute under that flag's existing warning
- **AND** under no other mechanism

#### Scenario: A scan's gate is unaffected

- **WHEN** `check` scans a repository holding a runtime rule
- **THEN** it SHALL apply its existing policy unchanged: a signature returned in `run` by an authenticated reconcile, or `--dangerously-run-scripts`
- **AND** the fixture runner SHALL NOT alter what a scan executes
