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

**Non-Goals.** Loosening the execution gate anywhere. Adding a runtime-specific
bypass. Touching `check`'s behaviour at all — its gate, its reconcile and its
use of `planRuntime` are exactly what they were. Making `check` run fixtures:
`check` scans a repository, `test` runs fixtures, and that separation is why
the two can hold the same flag without holding the same policy (D1).

## Decisions

### D1 — `test` takes the flag half of `check`'s gate, and no reconcile at all

Nothing about a fixture makes the code safer. The bytes do not know what
directory they are pointed at, and "it is only running against test data" is a
statement about the input, not about what the program may do. So a fixture run
is gated, and `--dangerously-run-scripts` is that gate — the same flag `check`
carries, spelled the same way, printing the same warning.

**What `test` does not do is reconcile.** The first draft of this change shared
`check`'s whole gate, which meant `test` called `getToken`, and on a project
holding any runtime rule went on to `resolveOrgSubject` and `reconcile` over
the network. `test` had been fully offline before this change, and that is the
half that was wrong.

The two commands execute rules for different reasons, and the gate belongs to
the reason rather than to the code:

- `check` executes rules as a **side effect** of scanning a repository. Nobody
  asked for code to run; they asked for a report. The gate is what stands
  between the request and the execution, so that code never runs silently.
- `test` runs fixtures **because the user asked it to**. The verb is the
  consent. Asking a server for permission to run your own fixtures is
  overreach, and it is not the kind of overreach that buys safety.

Ask who a reconcile in `test` would ever admit, and the answer is: someone
testing an already-blessed delivered rule — a rule the service verified against
failing and passing examples on its way to accepting it. That is the one
audience for whom running the fixtures locally proves least. Meanwhile a
locally authored rule has no signature and never will, because blessing is
recording and nothing recorded it (D6), so for the audience that actually runs
`test` on a runtime rule the reconcile is pure cost paid for an answer that is
always "no".

**This is strictly more conservative, not a softening.** Nothing executes under
`test` that would not have executed before, and one thing that would have —
a blessed delivered rule, running with no flag — now requires the flag. There
is no security argument against it, because there is no case where the new
behaviour runs code the old behaviour refused.

It also disposes of the `--anonymous` question rather than answering it. The
review asked whether `test` should carry `check`'s `--anonymous` flag to
suppress the network call. With no network there is nothing to suppress, and a
flag whose only job is to turn off a call that should not have been there is a
worse answer than not making the call.

The one property that had to survive is that the fixture path is not a _softer_
gate than the scan path, since that would be the client-side bypass the runtime
spec forbids reached by a different route. It survives by being a _stricter_
one.

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

### D6 — Testing a runtime rule requires the flag, authored or delivered

Under D1 the flag is the whole gate for `test`, so this is now true of every
runtime rule rather than only of unblessed ones. The authored case is still the
one worth stating, because it is the one where a reader will look for a way
out and find none: a locally authored rule has no signature and never will,
because blessing is recording and nothing recorded it. Its author must pass
`--dangerously-run-scripts` to test their own rule, which `sg` and `vale`
authors do not have to do.

**The message must not send them to `auth login`.** The first draft inherited
`check`'s "not authenticated" reason, which reads like the fix and is not one:
authenticating would not have blessed a rule that never left the working tree.
With reconcile gone the message names the flag and nothing else, and a test
asserts the absence.

That is friction and it is the correct friction. The alternative is a rule that
executes unblessed code because it happens to live in the working tree, which is
exactly the property the gate exists to deny — a delivered rule and an authored
one are indistinguishable on disk. The warning the flag prints is accurate in
both cases.

Worth stating in the recipe rather than discovered: an author who runs `test`
and sees "did not run" should be told the flag in that message.

### D7 — Nothing to test means the delivery was incomplete, and that belongs in delivery

`test` failing a fixtureless rule is the right answer for a rule someone wrote.
It is the wrong place to catch a rule the service sent, because by then the rule
is on disk and the failure reads as the holder's fault for a file they never
authored.

Delivery already answers "is this a complete rule": `describeIncompleteSet`
requires the rule file, the per-engine config where one exists, and at least one
capture, and the whole set is assessed before anything is written so a refused
delivery leaves no directory behind. A rule with nothing to test is incomplete
by the same standard as a rule with no captures. Both are rules that cannot
demonstrate anything, and both are cheaper refused than written.

This is the styleguide's own rule about build output applied to a payload: an
invariant enforced where the artifact is produced cannot be violated, while one
enforced afterwards can only be detected.

**This is not a negotiation.** A runtime rule ships with a `.tests/` directory;
a delivery without one is a defect on the service side, not a payload shape we
are asking them to adopt. They already hold the material — their verification
gate executes the generated check against failing and passing examples on its
way to accepting the rule — and they have already established that fixtures are
files in the collection rather than a field beside it.

**What is sequenced is enforcement, not the expectation.** Being right about
whose bug it is does not stop `describeIncompleteSet` from turning that bug into
a refused write for every user, with nothing written and no action available to
them. So the order is: confirm deliveries carry `.tests/`, and if they do not,
file it as the defect it is rather than proposing it as a change. Enforce once
the fix has shipped.

That leaves the two halves landing in the right order for a reason that has
nothing to do with agreement. `test` failing an authored rule is ours alone and
ships now. Delivery completeness follows once we know we are enforcing a rule
the service already satisfies, rather than discovering it does not through an
outage.

### D8 — A case that never reaches the check is its own outcome, not zero findings

`executeRuntimeRule` runs the narrow first and gates on it:

```ts
if (matches.length === 0) return []; // gate: no matches, no check
```

So a fixture case whose narrow matches nothing returns an empty array having
never invoked `check.ts`, which is indistinguishable downstream from a check
that ran and found nothing. Under the scenarios as first drafted, a `fail/` case
in that state fails, and the message blames the check for a fixture that never
reached it.

That is this change's own failure mode, reintroduced inside the fix. The runner
therefore has to know whether the check was **invoked**, not only what it
returned, and report three outcomes per case rather than two.

It matters in both buckets, and the `pass/` side is the quieter half. A `pass/`
case with no narrow matches looks like a clean pass and proves nothing about the
check: it demonstrates that the narrow did not match, which is a fact about the
fixture. A case that never invokes the check cannot show the check stays quiet,
so counting it as evidence is the same empty-scan-reports-success shape one
level down.

So a case producing no narrow matches is reported as a **fixture defect** in
either bucket, naming the case and saying the check never ran. It is actionable
in a way "expected a finding, got none" is not, and it points at the file the
author has to change.

### D9 — The third fixture reader is the one that had to be shared

The Vale runner is the model this change copied (see Context), and copying it
verbatim is what made the copying a problem. `rules/vale/verify.ts` carried a
`directoryEntries` whose doc comment called itself "the single place that
decides which `readdir` failures are absence and which are problems, so no
caller can accidentally answer that question differently" — a claim a third
near-identical copy falsified the day it was written.

The drift was already measurable rather than hypothetical: the "half a claim"
coverage message existed in three places.

So `rules/fixtures.ts` now holds the two decisions that are genuinely the same
across `sg`, `vale` and `runtime` — the missing-versus-unreadable
discrimination, and the four-way coverage classification with its message — and
all three engines call it.

**What stayed local is what is genuinely different, and it is the rejection.**
Vale's buckets hold documents, so a nested DIRECTORY is its error; runtime's
hold one directory per case, so a loose FILE is. Those are opposite rules for
the same-shaped read, and folding them together would have needed a flag that
made the shared function harder to read than the two callers it replaced.

One thing looked like drift and was not. The coverage message spells the bucket
`valid:` for `sg` and `pass/` for the other two. That is not two punctuations
for one idea: ast-grep's buckets are keys in a test YAML document and the other
two are directories, so each names the bucket in the shape its author will go
looking for. It is a parameter of the shared message rather than something
normalised away.

The classification is parameterised on the bucket names for the same reason
(`FixtureCoverage<"valid" | "invalid">` against `FixtureCoverage<"pass" |
"fail">`), so the three engines share one set of four states under their own
vocabularies rather than sharing a vocabulary they do not have.

`sg`'s own test-file enumeration was left alone deliberately. It catches every
`readdir` failure as "no test files", which is the leniency this module exists
to prevent — but fixing it changes what `sg` reports on an unreadable `.tests/`,
and that is a behaviour change wearing a refactor's clothes. It belongs in its
own change, with its own test.

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
