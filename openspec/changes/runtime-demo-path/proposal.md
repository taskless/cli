## Why

The runtime tier cannot be demonstrated, and it cannot be smoke-tested end to
end. Everything we can exercise alone covers the pieces — discovery, signing,
the file-set writer, delivery validation, the repair path — and none of it
covers the two things that only exist between the client and the service:
generation producing a runtime rule, and delivery handing it over in a shape
this client accepts.

That gap is why the payload alignment work took the shape it did. Both sides
held the same assumptions separately, and every defect the exchange surfaced
lived in the seam: two floors that could disagree, a signature attached to the
wrong rule, a capture silently dropped, a rule written and never run. Each was
found by hand, by someone noticing. There is still no single command that walks
the whole path and shows what happened.

A demo path closes that. Run one command, get a real generated runtime rule
written to disk, and see it verified. It is a live demo for a person, and the
same command is the closest thing we can have to an integration test across the
repository boundary.

**Delivery shape: single PR.** The client half is one recipe, one command, and
their tests. Splitting it would separate a command from the recipe that names
it, which is the seam this change exists to remove.

## What Changes

**A hidden agent topic, `__undocumented-sample-runtime`.** Absent from the
`agent` index on purpose: `RECIPE_TOPICS` in `commands/agent.ts` is a
hand-maintained literal and lookup is by filename, so a topic that is not in
the list is fetchable by name and invisible otherwise. No new mechanism. This
is something we run deliberately, not something routing sends an agent to.

**A command that walks the path, as `rule demo`.** Request, poll, retrieve, write, verify —
through the existing `submitRule` / `pollRuleStatus` client code and the
existing `writeRuleFile`, against demo endpoints that mirror the mainline
shapes:

```
POST /cli/api/demo/request                 -> { requestId, status }
GET  /cli/api/demo/request/{requestId}     -> { requestId, status, rules[], examples[] }
```

**The endpoints take no authentication at all.** We asked that an
unauthenticated call send no `Authorization` header rather than one carrying an
empty token. The service went further: with nothing scoped to a caller there is
nothing for authentication to decide, so the demo endpoints are public, like
`rule-hash-vectors`. There is no header to send and none for the service to
decide how to ignore. Making `submitRule` and `pollRuleStatus` tolerate an
absent token remains ours (task 1.2a); the server half is now a property rather
than a convention.

**The retrieval also serves what the rule found.** The service's verification
gate already executes the generated `check.ts` against the fixture's failing and
passing examples on its way to deciding whether to accept the rule, and was
discarding the result. `examples[]` carries it: for each fixture example, its
name, whether it is expected to fail or pass, and the `Finding[]` the check
produced against it.

Mirroring is the point. A bespoke demo payload would exercise a path no user is
on, which is the one thing a demo must not do. Reusing the well-known formats
means the demo also covers polling and the terminal `failed` / `unsupported`
states rather than a happy path built for the occasion.

**The demo cannot reach the gate, and that is structural rather than a
choice.** A runtime rule executes only when an authenticated reconcile returns
its signature in `run`, and a signature exists because the rule was recorded
into an organization's corpus — recording is what blessing is. The demo rule is
one fixed rule, generated under a Taskless-owned installation and never recorded
for the caller, so no caller's `run` set can contain it. Authenticating would
not change that. The demo reaches a complete, well-formed, verified rule on disk
and stops, and `check` explains that state in the words it already uses.

**No client-side bypass.** Not for a known demo id, not behind a flag of its
own. The signature gate is what stands between a downloaded payload and
arbitrary code execution on a developer's machine, and a demo is not worth a
hole in it. Executing the demo rule uses the documented
`--dangerously-run-scripts`, which prints the warning it always prints.

## Capabilities

### New Capabilities

- `cli-runtime-demo`: A deliberately-invoked path that generates, delivers,
  writes and verifies one runtime rule from a fixed, service-held input, so the
  client-service seam can be shown working rather than described.

### Modified Capabilities

- `cli-agent`: The topic index is a curated list rather than every embedded
  recipe. A topic may exist and be fetchable by name while staying out of the
  index, which is already how the code behaves and is not yet stated as a
  requirement. The index's command listing is separately sourced from the
  top-level command tree, so staying out of the curated recipe list says
  nothing about that half.

## Impact

- `packages/cli/src/agent/__undocumented-sample-runtime.txt` — new recipe.
- `packages/cli/src/commands/rules.ts` — the demo as a `rule demo` subcommand,
  reusing `submitRule`, `pollRuleStatus` and `writeRuleFile` rather than
  duplicating them. Nested rather than top-level so it adds nothing to
  `SUBCOMMAND_NAMES` and therefore nothing to the `agent` index's command
  listing (design D4a).
- `packages/cli/src/api/` — the demo endpoints, alongside the existing client.
- Depends on the service half (raised as **N9** in the cross-team document).
  The endpoints are theirs to build; the shapes above are what we asked for and
  what this change assumes.
- Sequenced behind the `request`/`requestId` rename (**N10**), which has now
  shipped and is verified live. The demo takes that noun. Adopting it in the
  ordinary client is a separate change and is not this one's dependency.
- No change to the runtime gate, to reconcile, or to `check`'s execution
  policy.
