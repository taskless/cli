---
"@taskless/cli": patch
---

`check` no longer risks losing every Vale finding in a run to one oversized
file. Vale's cost is quadratic in a single file's size (measured against the
pinned binary: 128KB is ~0.8s for one rule, 384KB is already ~7s), and
`VALE_TIMEOUT_MS` bounds the whole run, not one file — a large enough
document could consume most or all of that budget on its own, and a timeout
discards every other file's findings along with it (the same failure #300
fixed, on a path #300 did not cover).

`runVale` now excludes a target file over 128KB (`VALE_MAX_FILE_BYTES` in
`src/rules/vale/run.ts`) before invoking Vale at all, the same preemptive
treatment already given to a format Vale cannot parse. Excluded files are
named in a `notices` entry, not reported as a failing finding: unlike an
unparseable file (where Vale itself proves the file was a real target by
erroring on it), this exclusion runs from a bare filesystem walk with no way
to confirm any rule's matcher would have reached the file — reporting it as
a blocking error produced false failures on files no rule ever touches (a
lockfile, a generated changelog).

A consumer may now see a `check` that previously counted a large file's
prose findings instead report a `notices` entry naming that file as skipped.
128KB is comfortably past hand-written prose (roughly 20,000 words); this
should only affect generated output, pasted data, or exported notes checked
directly against a matching rule.
