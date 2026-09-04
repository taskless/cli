---
"@taskless/cli": patch
---

Add `taskless demo`, which writes an example rule into the project so a tier
can be run, read and deleted rather than described. One sample per engine, and
each subject is chosen so the sample demonstrates its own tier:

- `taskless demo sg` — flags `eval(...)`. The evidence is one expression in one
  file, which is what makes it `sg` rather than runtime.
- `taskless demo vale` — flags `utilize` in markdown and suggests `use`, scoped
  to `**/*.md` so a demonstration never widens into a project's source.
- `taskless demo runtime` — flags any `process.env` read whose key is not
  declared in the repository-root `.env`. Deciding that needs both files at
  once, so it cannot be an `sg` rule.

Run in that order they answer what a single sample cannot: why there are three
tiers.

The rules ship with the CLI rather than being generated, so none can arrive
mis-tiered or incomplete. CI runs every one of them over the shipped bytes on
each change, and six mutation tests assert their fixtures still fail when they
should.

`check` will not execute the runtime sample. A runtime rule runs only when an
authenticated reconcile returns its signature, and a locally written rule was
never issued one, so it is skipped with the reason `check` already gives.
Running it uses the documented `--dangerously-run-scripts`. The `sg` and `vale`
samples are inert data and run under `check` like any other rule.

The same three rules are published as `@taskless/cli/demo-reference.json`, as a
conformance corpus rather than a pile of examples. Each entry carries the
generation prompt it answers, the rule itself, and the held-out cases — kept
apart, because the useful comparison is the cross: run a generated rule against
our cases, and our rule against the generated cases. From one flat file set
neither of those can be set up.

The corpus states its own protocol and carries the constraints `verify` and
`test` enforce beyond the engine's own schema, each saying which command
enforces it. A generator that never reads our recipes cannot know them, and
without the list a refusal is indistinguishable from a disagreement about the
subject.

`verify` now also refuses an `sg` rule whose `id:` does not match its directory.
Previously it passed: `test` could not find the rule at all, and `check` ran it
but reported findings under a name no directory has, so nobody could locate what
produced them.

Only the runtime rule carries a signature, deliberately
`1;h=sha-256;d=<64 zeros>`: well-formed, so it reaches signature comparison
rather than failing at the parser, and unmistakably synthetic, so it can never
be mistaken for a blessed one.
