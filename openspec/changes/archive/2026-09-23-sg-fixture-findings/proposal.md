## Why

`test` reports the findings a rule's fixtures produced for Vale and for
runtime, and reports an empty list for ast-grep. That was truthful and it was
the half of #386 left undone: an ast-grep rule whose `message` interpolates its
metavariables can have the slots in the wrong order, fire on every `invalid:`
snippet, stay quiet on every `valid:` one, and be reported green. The rendered
message is the only evidence otherwise, and `sg test` never renders it.

Two things made this harder than the other two engines, and neither is true any
more:

- **`sg test` cannot produce a finding.** Measured against the vendored 0.45.3
  binary: `ast-grep test --help` offers `--filter`, `--skip-snapshot-tests`,
  `--update-all`, `--interactive`, `--include-off` and `--color`, and no
  `--json` or output-format flag of any kind. Its only machine-readable output
  is the summary line `parseTestSummary` already reads.
- **ast-grep fixtures are not files**, so the `check <fixture path>` workaround
  that exists for Vale does not exist here. Measured:
  `pnpm cli check .taskless/rules/sg/ci-uses-workspace-cli/.tests --json`
  returns `{"success":true,"results":[]}` — the snippets are inline YAML
  scalars under `valid:`/`invalid:`, and there is no document to walk.

The route that was expected to be needed — materialise each snippet as a file
and scan it — requires a `language:` → file-extension mapping the CLI does not
own and cannot source reliably. `language:` takes ast-grep's own spelling
(`Yaml`, not `yaml`; the repo's own `ci-uses-workspace-cli` uses the
capitalised form), the set belongs to the binary, and a mapping that drifted
would silently scan a snippet as the wrong language.

`ast-grep scan --stdin` removes that question entirely. The language comes from
the rule's own `language:` key, parsed by ast-grep, so there is no mapping to
keep in step, no extension to guess, and no temp file to clean up.

## What Changes

- **`cli-rule-validation`** gains one requirement: the ast-grep engine reports
  the findings its fixtures produced, with rendered messages and positions that
  point back into the fixture file.
- `test --json` and the human render for an ast-grep rule now carry real
  `findings`, in the shape Vale and runtime already produce. Nothing about
  either of those engines changes, and the verdict `sg test` decides is
  untouched — findings are gathered after it and cannot alter it.

## Delivery shape

**Single PR.** The spec delta, the collector, the tests and the archive are one
reviewable diff of roughly 500 lines, well inside the ~1200-line guidance, and
there is no intermediate state worth landing on its own.

## Why ADDED rather than MODIFIED

The standing scenario "The findings array is present and empty rather than
absent" lists four WHENs, one of which is "whose engine does not surface fixture
findings". After this change no engine is in that state, so the disjunct is
inert — but it is not false, and the other three (a rule that produced nothing,
verification that failed first, a refused run) are all still live and still
tested.

Restating a ten-scenario requirement to delete one clause of one WHEN is the
operation that silently drops scenarios on archive, and the clause costs
nothing standing. The new requirement states positively that ast-grep surfaces
its findings, which is what a reader needs; the inert disjunct is left for a
change that has reason to touch that requirement for its own sake.
