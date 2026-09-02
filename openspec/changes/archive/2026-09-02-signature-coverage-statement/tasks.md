# Tasks

One PR. A single requirement gains two sentences.

## 1. State it

- [x] 1.1 Amend `Canonical rule signature envelope` so the algoVersion governs coverage as well as normalization and algorithm
- [x] 1.2 Say that a v1 signature covers exactly the engine's `ruleFile`, naming `check.ts` for runtime as the instance rather than as the rule
- [x] 1.3 Say that signing more than one file requires a later algoVersion, so the mechanism for changing coverage is the one that already exists

## 2. Keep it honest

- [x] 2.1 Confirm no source change is implied. **Verified**: `ALGO_VERSION` is 1 (`rule-hash.ts:14`), `signRuleFile` reads one path and hashes it (`rule-hash.ts:116`), `run-set.ts:41` signs `rule.checkFile` once per rule, and `ENGINE_LAYOUTS` gives every engine exactly one `ruleFile` (`<id>.yml` for sg and vale, `check.ts` for runtime) so the statement generalises rather than special-casing runtime
- [x] 2.2 Confirm the statement matches what the service does. **Confirmed by the generator team**, who declined-and-accepted in the same round: "a v1 signature covers the engine's ruleFile, multi-file signing would be v2" is recorded in their half of the cross-team document as settled, not proposed

- [x] 2.3 Carry every existing scenario into the MODIFIED delta. **A delta is a replacement, not a patch**: measured by archiving this change and diffing the result, `openspec archive` rewrites the requirement to exactly what the delta contains, so `Version is read before parameters` and `Signatures compare as whole strings` were dropped from the standing spec until they were restated here

## 3. Close out

- [x] 3.1 Archive the change. Archiving is what promotes the delta into the standing spec, so until this ran the coverage statement lived only in the change directory and `openspec/specs/cli-rule-reconciliation/spec.md` did not carry it
