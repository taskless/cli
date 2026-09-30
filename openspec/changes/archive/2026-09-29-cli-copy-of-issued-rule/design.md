## Context

`applyVerdicts` (`packages/cli/src/rules/verdicts.ts`) is the pure policy that
turns a v2 reconcile answer into what `check` does with each reported rule. An
`unknown` static rule runs silently; an `unknown` runtime rule is not executed;
a `missing` rule warns. The service contract (taskless/taskless#262 design D7,
published by #264) adds `copyOf` to `unknown` entries:

```
unknown: [{ ruleId, copyOf?: { ruleId, revisionId, files: [{ path, expected?, got? }] } }]
```

`files` pairs by digest before path, so a file carried unchanged under a new
name is not listed.

## Goals / Non-Goals

**Goals:** an sg/Vale copy fails `check` naming its source and the differing
files; a copy whose source is `missing` is reported once, as a rename; nothing
changes for a response without `copyOf`.

**Non-Goals:** detecting copies locally (the CLI has no issued digests); any
change to `missing` on its own; an override flag (the contract has none).

## Decisions

### D1. Read `copyOf` defensively; do not touch the vendored schema

`applyVerdicts` already takes the response as `unknown` and parses every field
it uses, so the generated types add nothing to the policy. The vendored
`api-v2.schema.json` is documented as the live API's own account of itself;
hand-extending it with a field that is not deployed would make it claim what the
service does not yet serve, and would be overwritten by the next
`generate:api` anyway. It is re-vendored once #264 is live.

### D2. A copy stays `unknown` in the disposition and in `integrity`

The service keeps the copy in `unknown` (its D1), so the CLI does too, and adds
`copyOf` beside it. No new `IntegrityVerdict` value: a consumer keyed on the
verdict set keeps working, and `copyOf` is the additive signal. The diff goes in
the existing `files` field, which already means "what differs from what was
issued".

### D3. Rename detection: the source is in this answer's `missing` set

A copy whose `copyOf.ruleId` is answered `missing` (and was not itself reported)
is a rename. The copy's message says the source was deleted and names
`rule restore <source>`, and the source's own `missing` notice is suppressed.
The source's `missing` entry stays in `integrity`: both facts are true, and that
entry carries the `revisionId` restore brings back. The "one finding"
obligation is about what a person reads; `integrity` is per-rule state, and the
copy's `copyOf.sourceMissing: true` links the two for a machine reader.

### D4. Runtime copies: unchanged outcome, source named

A runtime `unknown` rule is never executed without `--dangerously-run-scripts`,
so the outcome stays. Its skip reason names the source, since that is the first
thing a reader will want and costs nothing. A plain runtime copy gets no notice
(its skip reason covers it, as for any runtime `unknown`). A runtime rename is
one notice, because it replaces the `missing` warning that would otherwise have
been printed; it does not fail the run, matching `unsafe` runtime rules.

### D5. A malformed `copyOf` fails closed

`copyOf` absent or `null` is a local rule. Present but not an object with a
non-empty string `ruleId` is treated as unaccounted: not run, and the run fails.
The service sends `copyOf` only when it found issued content, so even an
unreadable one says "this is a copy"; ignoring it would run exactly the rule the
field exists to stop. This follows the policy's existing rule that an answer the
CLI cannot read never makes a run greener. `revisionId` and `files` are read
tolerantly: only the source id is needed to act.

## Risks / Trade-offs

- **A local rule legitimately started from an issued rule's file fails** until
  that file is changed. Intended by the service contract; the message names the
  source, and the recipe says to write the rule from scratch.
- **Before #264 deploys** no response carries `copyOf`, so the behavior is
  inert, not wrong.
