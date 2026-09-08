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
treatment already given to a format Vale cannot parse — but only when some
Vale rule's own `.vale.ini` section could actually reach that file.
`assembleValeConfig` now returns the section patterns it wrote alongside the
config path, and the size scan globs by those patterns (`findOversizedFiles`
in `src/rules/vale/formats.ts`) instead of walking every file in the project.
A first version of this fix scanned the whole tree unconditionally and named
`pnpm-lock.yaml` and `packages/cli/CHANGELOG.md` as "not checked" on this very
repository, even though no rule's matcher touches either file — Vale was
never going to open them, so that was a false positive, not a caught coverage
hole. Excluded files are named in a `notices` entry rather than a finding:
unlike an unparseable file (where Vale itself proves the file was a real
target by erroring on it), this exclusion is a preemptive guess from a
filesystem walk, and a soft advisory fits an unconfirmed guess better than a
hard error.

A consumer may now see a `check` that previously counted a large file's
prose findings instead report a `notices` entry naming that file as skipped
— but only for a file some rule's own scope actually reaches. 128KB is
comfortably past hand-written prose (roughly 20,000 words); this should only
affect generated output, pasted data, or exported notes checked directly
against a matching rule.
