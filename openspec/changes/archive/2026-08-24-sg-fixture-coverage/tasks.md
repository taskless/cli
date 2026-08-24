Delivery shape: **single PR**. The coverage check, the tests that pin it, and the spec delta land together — the check is not correct in halves, and landing it without the spec would leave the spec endorsing the gap.

## 1. Coverage classification

- [x] 1.1 Add `SgFixtureCoverage` and `coverageOf()` to `rules/verify.ts`, mirroring `ValeFixtureCoverage` state for state with ast-grep's `valid`/`invalid` vocabulary
- [x] 1.2 Add `fixtureCoverage()`, parsing each `-test.yml` with the `yaml` parser already imported at the top of the file rather than deriving counts from `ast-grep test` output — the run says nothing useful, since an empty `invalid:` bucket is still `1 passed; 0 failed`
- [x] 1.3 Sum across every test file the rule owns; coverage is a property of the rule, not of one dated file
- [x] 1.4 Carry `fixtures` on `TestLayerResult` and gate `valid` on it in `runTestLayer`; keep the field exported, since `TestLayerResult` is reachable from `verifyRule`'s signature under `declaration: true`
- [x] 1.5 Treat an unreadable or unparseable test file as contributing nothing — `sg test` reports malformed test YAML itself, and guessing a bucket count from a file we could not parse is a worse error than the one already being raised

## 2. Reporting

- [x] 2.1 Build the sg error list in `testOneRule` instead of forwarding `tests.errors` unchanged
- [x] 2.2 Match the Vale branch's wording — "half a claim" for one-sided, "nothing shows it fires or stays quiet" for none

## 3. Vendor contract

- [x] 3.1 Pin that a standalone `$$$` matches a zero-argument call — the reported bug, which is not real in that shape
- [x] 3.2 Pin that `foo($A, $$$)` does NOT match a one-argument call, and that `foo($$$, $A)` matches only the one-argument call
- [x] 3.3 Pin that `strictness: ast` inside the pattern object moves the trailing-`$$$` boundary from `>= 2` to `>= 1` — not to zero, since `$A` still has to bind
- [x] 3.4 Pin that `strictness` at rule level fails the scan rather than being silently ignored, since the remedy depends on the placement

## 4. Schema examples

- [x] 4.1 Add a `RULE_EXAMPLES` entry showing the object-pattern `strictness: ast` form, naming the separator mechanism and the leading-`$$$` exception

## 5. Verification

- [x] 5.1 One `verify.test.ts` case per coverage state; nothing covered an empty bucket before this change
- [x] 5.2 `pnpm typecheck`, `pnpm lint`, `pnpm test`
- [x] 5.3 Reproduce the gap against a scratch project before and after, confirming `test` flips from `ok: true` to a coverage failure and that the `strictness: ast` remedy makes `check` fire
- [x] 5.4 Add the changeset, and say in it that previously accepted rules now fail
