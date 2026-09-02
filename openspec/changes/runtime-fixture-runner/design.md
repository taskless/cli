## Context

**Runtime rules do execute today.** `check` runs them against the repository
through `dispatch.ts:205` into `executeRuntimeRule`, gated by the signature
planning that happens before dispatch. The executor, the process spawn, the
timeout and the result shape all exist and are exercised on every authenticated
`check`. Nothing here is about making runtime rules runnable.

What is missing is running them against **fixtures**. Three engines, three
fixture stories, and one of them is absent. `sg` runs `ast-grep test` over
`.tests/`; `vale` runs its rule over `pass/` and `fail/` buckets and checks both
directions; `runtime` returns `ran: false, ok: true` and prints a tick. Two
commands, one engine, one of them wired up.

The Vale runner is the model, and it is worth reading before writing this one:
`rules/vale/verify.ts` already carries the lessons this tier will otherwise
relearn. Buckets are read independently, so a swallowed `EACCES` on `pass/`
cannot present as "no pass fixtures were written". A nested directory is
rejected rather than ignored, because the reader is flat while the engine
recurses, and silently skipping an entry fails in the dangerous direction.
Coverage is a four-way classification rather than a boolean, because
`fail-only` is more misleading than `none`.

## Goals / Non-Goals

**Goals.** Run a runtime rule's fixtures. Report honestly when they did not run.
Make `.tests/` mean something for the one tier that ships them and reads none.

**Non-Goals.** Changing the execution gate. Adding a runtime-specific bypass.
Making `check` run fixtures — `check` scans a repository, `test` runs fixtures,
and that separation is why the gate can be shared without the commands merging.

## Decisions

### D1 — The gate is `check`'s gate, unchanged

A fixture run executes `check.ts`. That is the same code, from the same
delivery, with the same signature, as the code `check` runs against a
repository. So it runs under the same policy: blessed by an authenticated
reconcile, or `--dangerously-run-scripts`.

Nothing about a fixture makes the code safer. The bytes do not know what
directory they are pointed at, and "it is only running against test data" is a
statement about the input, not about what the program may do. A separate,
softer gate for fixtures would be the client-side bypass the runtime spec
already forbids, arrived at by a different route.

### D2 — A run that did not happen is a third state, not a pass and not a failure

This is the decision the whole change turns on.

Today the runtime branch returns `ok: true`, which is wrong. The obvious
correction is `ok: false`, and it is also wrong: a rule that cannot run because
nothing blessed it is not a defective rule, and failing it would turn `test` red
for every project holding a runtime rule, with no action available that makes it
green. That trades a silent wrong answer for a loud useless one.

So `test` reports three outcomes for a runtime rule: it ran and the fixtures
behaved, it ran and they did not, or it did not run and here is why. The third
prints its own marker rather than a tick, names the reason, and does not count
toward "N rule(s) tested". `ran` stops being advisory metadata in the `--json`
envelope and becomes the field a caller branches on.

The precedent cuts the other way for the other engines and that is consistent
rather than contradictory. `verify.ts` says "skips are errors, never a pass",
and for `sg` a skip means something went wrong — the runner exists, so declining
to use it is a fault. For `runtime` the run is refused by a security policy
working as designed. Same word, two situations, opposite correct handling. That
distinction is the one this codebase got wrong once already with `unsafe` versus
`missing`.

### D3 — A fixture case is a directory, because the harness already takes a root

This is less a choice than an observation. `executeRuntimeRule(root, rule,
options)` in `runtime/harness.ts` already takes a root, and `check` reaches it
through `dispatch.ts:205` with the repository root. A fixture case directory is
simply a different root handed to the same function.

So the runner is a caller of the existing executor rather than a sibling of it:
a loop over case directories plus the pass/fail assertion. Process spawn,
timeout, narrowing, capture discovery and the result shape are all shared with
`check` and already proven there. Any other case layout would need new plumbing
instead of reusing what exists, which is the argument for directories rather
than a preference for them.

Vale's buckets hold documents; runtime's hold **directories**, one per case.
`types/runtime-rule.ts` defines a check as a function over `(root, matches)`
reading files under `root`, and `create-runtime-rule.txt` already documents
`.tests/pass/case-1/` with that meaning.

This is not a stylistic difference. A runtime rule exists because its evidence
spans more than one file, so a layout allowing one file per case could not
express the rules the tier is for. It also settles the recursion question Vale
had to answer: a bucket is read one level deep, and each entry must be a
directory. A loose file directly in `pass/` is an error naming the path, not a
case with an implicit root.

### D4 — Coverage is classified, and only `both` can pass

Copied from `ValeFixtureCoverage` deliberately, including the reasoning. A rule
with only `fail/` cases has shown it fires and not that it stays quiet; a rule
with only `pass/` cases has shown the opposite; and a rule with neither has
shown nothing while exiting zero. `none`, `pass-only`, `fail-only` and `both`
are kept apart because a caller says different things about them.

### D5 — Reading the buckets cannot be lenient

The Vale reader rethrows anything that is not a missing directory, because
swallowing an `EACCES` on one bucket makes a two-sided rule look one-sided and a
one-sided rule look complete. The same applies here and is worth stating rather
than inheriting by imitation: a fixture bucket that could not be read is an
error, never an empty bucket.

### D6 — Authoring a runtime rule locally now requires the flag

A locally authored rule has no signature and never will, because blessing is
recording and nothing recorded it. So its author must pass
`--dangerously-run-scripts` to test their own rule, which `sg` and `vale`
authors do not have to do.

That is friction and it is the correct friction. The alternative is a rule that
executes unblessed code because it happens to live in the working tree, which is
exactly the property the gate exists to deny — a delivered rule and an authored
one are indistinguishable on disk. The warning the flag prints is accurate in
both cases.

Worth stating in the recipe rather than discovered: an author who runs `test`
and sees "did not run" should be told the flag in that message.

## Risks / Trade-offs

**A rule with no fixtures fails, and that is the decision.** The other two
engines fail it, on the grounds that nothing shows the rule fires or stays
quiet, and making runtime the exception would leave the tier that executes
arbitrary code as the one whose rules need not prove anything.

Depth is not policed. A trivial case that exercises little and passes is
acceptable; the requirement is that a rule has fixtures, not that they are
thorough. But that latitude only reaches one bucket. A `fail/` case producing no
findings is the silent regression this runner exists to catch, so a case that
tests nothing can only be a `pass/` case, and the `fail/` case is the one that
has to do real work. That is also the one worth having, since it is what proves
the rule fires at all.

The cost is real and worth naming: runtime rules have not been carrying
fixtures, because nothing ran them, so this fails rules that were correct under
the old behaviour. That is the same trade this CLI already made when `check`,
`verify` and `test` stopped migrating silently — a wall met once, in exchange
for a report that means something.

**The runner is a second execution path.** It reuses `invoke.ts` rather than
reimplementing invocation, so a divergence between how a fixture runs and how
`check` runs is a shared-code question rather than a drift question. If the two
ever need different behaviour, that is the signal to stop and ask why.
