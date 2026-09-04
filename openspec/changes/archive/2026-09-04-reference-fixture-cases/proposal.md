## Why

The cloud team grades rule generation against `@taskless/cli/reference.json`
(#263). They hit a defect our shape made hard to see, and the fix changes how
they model fixtures everywhere.

Their request format carried a rule's cases as anonymous code strings — one
blob per case, no filename, no siblings. Generating from our
`runtime/env-keys-declared` prompt therefore produced a rule that **failed the
fixtures we ship beside it**, because our case is a two-file tree:

```
.tests/pass/declared/src/config.ts   .tests/fail/undeclared/src/config.ts
.tests/pass/declared/.env            .tests/fail/undeclared/.env
```

Reading one file to judge another is the entire reason that rule is `runtime`
rather than `sg`. A single-file case cannot express it, so nothing was declared
and the passing case flagged too.

**Their shape is theirs to fix. Ours is what let it go unnoticed.**
`reference.json` publishes `tests` as `Array<{ path, content }>`, and recovering
which files belong to which case requires knowing our layout:

| engine    | a case is                                                                             |
| --------- | ------------------------------------------------------------------------------------- |
| `runtime` | a **directory** under `pass/` or `fail/` — many files                                 |
| `vale`    | a **file** under `pass/` or `fail/` — one document                                    |
| `sg`      | not a directory layout at all: `valid:`/`invalid:` keys inside one ast-grep test YAML |

That table is in our code three times (`rules/runtime/fixtures.ts`,
`rules/vale/verify.ts`, `rules/verify.ts`) and nowhere in the artifact that is
supposed to be authoritative about it. Every consumer transcribes it, and a
transcribed fact goes stale silently — which is the same failure mode
`RULE_CONSTRAINTS` was published to close, one field over.

The corpus has no spec at all today. It was added across three `chore` commits
and is now an external contract with another team, which is the wrong order.

## What Changes

**`tests` states its own grouping.** It becomes an object carrying a `grouping`
discriminant, the flat file list it carries today, and — where the grouping is
_ours_ — an explicit list of cases. A consumer branches on `grouping`, a published
field, instead of on `engine` plus knowledge it copied from us.

**`sg` keeps its ast-grep test YAML, and says so.** Its grouping lives inside
that file in ast-grep's own documented schema. Restating it here would move a
fact out of the upstream schema that owns it and into a copy we would then have
to keep true. `grouping: "ast-grep-test"` names that, so a consumer knows the
absence of `cases` is a statement rather than a gap.

**The corpus states where a rule lives.** A top-level `layout` block carries the
tree — `.taskless/rules/<engine>/<id>/`, which file _is_ the rule for each
engine, where its config and captures go, what the tests directory is called —
and each entry carries its own resolved `directory` and `ruleFile`. Every value
is derived from `ENGINE_LAYOUTS`, the table the CLI itself dispatches on.

Without it the corpus publishes paths relative to a root it never names, so a
consumer materializing a rule — ours to run, or their own generated answer to
the same prompt — has to assume where the CLI looks. That assumption is not
recoverable from anything in the file. `@taskless/cli/layout` publishes the
table already and exists for exactly this reason, but it is a JavaScript module,
and a consumer reading a JSON artifact should not have to import a bundle to
find out what the artifact's paths are relative to.

**`.taskless` gets one home.** It is currently a string literal in about fifteen
places behind four separate constants (`CANONICAL_DIR` twice, `TASKLESS_DIR`,
`TASKLESS_DIRECTORY` twice), so there is no single value the corpus could be
generated from. `TASKLESS_DIRECTORY` moves into `rules/layout.ts` beside the
rest of the table and `rulesRoot` reads it. The other call sites are left alone;
converging them is a tidy-up that does not belong in a contract change.

**`version` goes to 2.** The consumer asserts it on load and stops rather than
interpret a shape it does not understand, which is the correct behaviour and
the reason a bump is enough of a signal.

**`verify` and `test` name the constraint a rejection violated.** Each rule
result gains `violations`, pairing a `constraintId` from the published
`constraints[]` with the message that reports it. `errors` is unchanged and
still carries every message, so nothing that reads it today breaks. Without
this, mapping a rejection back to the rationale we already wrote is a text
match on our wording, which rots the first time we rephrase an error.

**The output shapes become importable.** `@taskless/cli/schemas` publishes the
zod schemas for `verify --json` and `test --json`, and the constraint type. A
consumer parsing our JSON currently hand-writes the interface for it, which is
transcription of exactly the kind this issue is about, one field over from the
layout table. Data only: no filesystem, no spawn, no command tree.

The CLI stays the execution surface. No `verify()` or `test()` function is
exported. Both spawn a vendored platform binary, so anywhere a function call
could run them `npx @taskless/cli verify --json` runs too — the export would buy
a call site, not a capability, while making internal signatures public in the
same release that changes them.

## Delivery shape

**Stacked, merging forward — two PRs.** Each is independently safe in
production and neither leaves the other half-migrated:

1. `reference.json` v2. Self-contained: the artifact, its generator, its spec.
2. `violations` on `verify`/`test` output. Purely additive to a JSON envelope,
   and useful whether or not (1) has landed.
3. `@taskless/cli/schemas`. A new export, and it goes last on purpose: it
   publishes the envelope (2) changes, so shipping it first would publish a
   shape and then immediately amend it.

The changeset goes on PR 1 and each PR above extends it.

## What this does not do

**It does not extract `sg` snippets into cases.** Running an sg rule against
these cases means handing the YAML to `ast-grep test`, which consumes the file
as it stands; a snippet list would be a second representation of something no
consumer has to read. Reconsider if someone actually needs the snippets apart
from the file.

**It does not attach a constraint id to every error.** Only the seven entries in
`RULE_CONSTRAINTS` have one. An error with no constraint behind it gets no id
rather than a plausible-looking one, because a wrong attribution sends someone
to the wrong rationale, which is worse than sending them to none.
