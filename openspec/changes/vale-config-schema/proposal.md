## Why

A per-rule `.taskless/rules/vale/<id>/.vale.ini` is the one rule input nothing validates. The style YAML goes through `schemas/vale-rule.ts` and the pinned corpus; the config is carried into the assembled run config as verbatim text. `assemble.ts` strips a copied-in `StylesPath`/`MinAlertLevel` with `line.split("=")[0]` and recovers matchers with `/^\[(.+)\]$/`; `verify` checks that the file contains a `[` and the substring `<id>.<id>`. Nothing checks that a matcher carries the `tskl) rule` breadcrumb, that a value is `YES` or `NO`, that an assignment names this rule and not another one, or that the run-level keys stayed out. The spec says a rule SHALL NOT be able to override another rule's matchers, and nothing enforces it.

The gap is visible in a dogfood repository (eleven voice rules over ~1,100 markdown files, notes dated 2026-09-21): a fourth `.taskless/**` matcher copied into every rule to keep fixtures quiet under a bare `vale` run that `check` never performs, a duplicated key whose meaning flipped when Vale 3.21.0 moved repeated assignments from first-wins to last-wins, and matchers whose ordering only a person who has read the scoping spec can tell is backwards. Each of these is a config that Vale accepts and that does something other than what its author wrote, and the engine's design exists to remove exactly that class of silent failure.

## What Changes

- **Every per-rule config is parsed into an AST** with `@jedmao/ini-parser` (`resolve: false`, `delimiter: /=/`; blank lines, which the parser reports as empty unnamed sections, are dropped). The AST is lossless and ordered, so every check below is a refinement over the file's own sequence and nothing is re-derived from text. The parser was chosen by measurement against four alternatives: the `ini` lineage nests section names on `.` and loses source order, both fatal for a file whose sections are globs and whose order is its precedence; `iniparser` drops the `tskl) rule` key; `config-ini-parser` truncates it to `rule` and is GPL-3.0. Recorded in taskless/cli#359.
- **A zod schema over that AST**, `schemas/vale-config.ts`, keyed by the rule's directory id, rejects: any root-level property (`StylesPath`, `MinAlertLevel`, or anything else placed above the first matcher, which Vale reports as `W101` and ignores); a matcher without `tskl) rule = <id>`; an assignment key other than `<id>.<id>`; a value other than `YES`/`NO`; a non-empty `BasedOnStyles`; a file with no matcher; a file that never assigns `YES`. It reports, without rejecting: a key assigned twice inside one matcher; a `NO` matcher that precedes every `YES`; a `[*]` matcher; a `.taskless/**` matcher.
- **`verify` runs the schema** in place of its two substring checks, and the rejections are attributable: the first Vale entries in `RULE_CONSTRAINTS`, so `verify --json` pairs each with a `constraintId` the way it already does for `sg`. Advisories reach the reader on the rule's `notice`.
- **Assembly runs the schema and refuses the Vale run** when any rule's config is rejected, naming the rule and the line. This is the same treatment a malformed ast-grep rule already gets: the engine that owns the bad file reports a failure that reaches the exit code, and the other engines still run. A rule left out with a soft notice would verify, run, and report nothing, which is the failure being closed. Advisories go to the check's `notices`.
- **Assembly stays byte concatenation.** The header, then per rule a breadcrumb comment and the source file verbatim. The schema's rejection of run-level keys removes the only string edit assembly performs today, and `sections` is read from the AST's section names. No serializer is introduced; the parser's `toString()` is measured not round-trip safe and is never called.
- **The `create-vale-rule` recipe** says the config is schema-checked and what each rejection and advisory means, and its `.vale.ini` guidance drops the `.taskless/**` matcher. The `update` ledger records that a previously tolerated config now refuses the Vale run.

Nothing here is **BREAKING**: `0.y.z`, and the only behavior a consumer can observe is that a config Vale was already misreading now says so. `patch`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-vale-rule-engine`: a new requirement that a rule's config is validated against a schema before it is assembled, and that a rejected config refuses the Vale run; the "Per-rule scoping is expressed in the rule's own Vale config" requirement gains the statement that the schema enforces the cross-rule prohibition it already makes.
- `cli-rule-validation`: "Verify checks a rule's required components" gains scenarios for a rejected config; "A rejection names the constraint it violated" gains the Vale constraint ids.

## Impact

- New dependency: `@jedmao/ini-parser@0.2.4` (MIT, zero dependencies, ~300 lines, last published 2022). Pinned exactly. If it ever needs a change the file is vendored, not replaced with a parser of our own.
- `packages/cli/src/schemas/vale-config.ts` (new): parse and validate; exports the AST type, the rejection list with constraint ids, and the advisory list.
- `packages/cli/src/rules/constraints.ts`: first `vale` entries, `enforcedBy: "verify"` and one for assembly.
- `packages/cli/src/rules/inspect.ts`: `verifyOneRule` for `vale` calls the schema; the two substring checks and their messages become schema rejections. `violations` is no longer always empty for Vale.
- `packages/cli/src/rules/assemble.ts`: `ruleConfigBody` and `sectionPatternsOf` go; `assembleValeConfig` parses, validates, refuses on rejection, and concatenates the verbatim source. Its return carries the advisories.
- `packages/cli/src/rules/dispatch.ts`: a refused assembly becomes the Vale engine's `failure`; advisories join `notices`.
- `packages/cli/src/rules/vale/verify.ts`: the `buildIsolatingConfig` docblock still says a repeat inside one matcher is discarded, which stopped being true at 3.21.0; corrected in passing.
- `packages/cli/src/agent/create-vale-rule.md` (topic bump), `packages/cli/src/agent/update.md` (0.11.3 ledger line).
- Tests: schema unit tests over an ini fixture set (one file per rejection and advisory, plus the dogfood config shape), `verify --json` attribution for Vale, assembly refusal and the byte-identical assembly scenario re-pinned through the new path, and a vendor-contract case that the parser and Vale agree on which lines are matchers for the globs the corpus uses (`[*.md]`, `[docs/**/*.md]`, a character class like `[docs/[a-z]*.md]`).

## Delivery shape

**Stacked, merging forward, two PRs.** Each is safe on `main` alone:

1. Parser, schema, constraints, and `verify`. Stricter `verify` output and nothing else; `check` is untouched. The changeset lives here.
2. Assembly refusal, dispatch wiring, recipe, ledger, and the archive. Extends the changeset.

Ordering them this way means an author whose config would be refused hears it from `verify` in a release before `check` starts refusing it, which is the direction the existing "silent disable" guidance already pushes people.
