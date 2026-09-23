## 1. Measure the routes before choosing one

- [x] 1.1 Confirm `ast-grep test --help` on the vendored 0.45.3 binary offers no
      `--json` and no output-format flag, so the verdict path cannot carry
      findings.
- [x] 1.2 Confirm `check` over an sg rule's `.tests` directory returns no
      results, so the Vale workaround does not transfer.
- [x] 1.3 Measure `scan --stdin --json=stream`: it renders the message with
      metavariables interpolated and names the document `STDIN`.
- [x] 1.4 Measure that `files:` globs do NOT suppress a stdin scan, since a
      path-scoped rule would otherwise silently report nothing.
- [x] 1.5 Measure that `-r` isolates an unparseable rule (exit 8, no JSON),
      rather than aborting a whole config the way the assembled path would.

## 2. Spec

- [x] 2.1 Confirm the standing "present and empty" scenario's carve-out becomes
      inert rather than false, so ADDED is available and MODIFIED is not forced.
- [x] 2.2 Write the requirement as an ADDED block, restating nothing standing.
- [x] 2.3 Dry-run `openspec archive` and compare requirement and scenario title
      sets in `cli-rule-validation` before and after.

## 3. Collector

- [x] 3.1 Read each `.tests/*.yml`, applying the same `id:` exclusion
      `countFixtures` applies.
- [x] 3.2 Stream each `valid:`/`invalid:` snippet to
      `ast-grep scan -r <rule> --stdin --json=stream`.
- [x] 3.3 Map positions from snippet coordinates back into the fixture file for
      literal block scalars; anchor to the snippet's first line otherwise,
      rather than reporting a confidently wrong line.
- [x] 3.4 Report `file` as the cwd-relative POSIX path of the test YAML.
- [x] 3.5 Normalise ast-grep's `"note": null` to absent, which the `test`
      payload schema requires and `check` never validated.
- [x] 3.6 Return an empty list for every shortfall — no rule file, no tests, a
      rule ast-grep refuses — so gathering findings can never change a verdict.

## 4. Wire in

- [x] 4.1 Populate `findings` on the sg branch of `testOneRule`, after the
      verdict is decided.
- [x] 4.2 Leave Vale, runtime and the shared human renderer untouched.

## 5. Tests

- [x] 5.1 Message-order regression: a two-metavariable message, asserted on the
      rendered string.
- [x] 5.2 Mutation-check it by swapping the message's slots; confirm the
      assertions go red.
- [x] 5.3 Both buckets: an `invalid:` snippet that fires, and a `valid:` one
      that wrongly fires and makes the run fail.
- [x] 5.4 Exact line and column, proving the mapping back into the fixture file.
- [x] 5.5 A `language:` the binary does not know degrades to empty findings.
- [x] 5.6 No temp files left behind, on a passing run and a failing one, with
      the CLI's temp directory redirected so the assertion is not measuring
      other suites.
- [x] 5.7 Mutation-check 5.6 by making the collector write a temp file; confirm
      it goes red.
- [x] 5.8 Replace the standing "empty for an ast-grep rule" case with one that
      is still true — a rule whose fixtures matched nothing — without weakening
      it.
