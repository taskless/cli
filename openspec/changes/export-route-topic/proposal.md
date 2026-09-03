## Why

`cli-knowledge-prompts` says `route` is not exported, and gives the reason: it
contains local mechanics a Worker cannot run, so until that changes a consumer
"gets each destination's own scope from these three and adjudicates a genuinely
ambiguous call itself."

That second half failed in production, and the platform generator is the
evidence. It adjudicated the ambiguous calls itself: it hand-wrote the same
judgement `route` describes, reached a two-value classification with no way to
name `vale`, and generated every prose rule as an ast-grep rule while its own
delivery layer could already serve a Vale one. It shipped a tier it could not
produce, and neither side noticed until the demonstration returned the wrong
one.

The local mechanics remain real and do not follow. A consumer ignores them,
which is a smaller and more honest adaptation than restating the criteria.

## What Changes

**`route` joins `TOPICS`.** The requirement covers both halves of the decision
rather than the destinations alone: a consumer that can author for every engine
must also be able to reach the choice between them.

The spec's own argument already contains this. It says exporting a chooser
without its destinations strands a consumer that can route but not author. The
mirror is what we shipped, and it is worse in one specific way: a consumer
missing a destination stops, while a consumer missing the chooser writes its
own.

## Capabilities

### Modified Capabilities

- `cli-knowledge-prompts`: the exported-topics requirement covers the chooser as
  well as the destinations, and records why the withholding argument did not
  survive contact with a consumer.

## Impact

- `openspec/specs/cli-knowledge-prompts/spec.md` — one requirement, amended.
- `packages/cli/src/prompts/index.ts` — `route` moves from `INTERNAL_TOPICS` to
  `TOPICS`, shipping in the same PR.
- The completeness check (`TOPICS + INTERNAL_TOPICS` accounts for every canonical
  recipe on disk) is unaffected: the topic moves between lists.
