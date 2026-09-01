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

**A command that walks the path.** Ticket, poll, retrieve, write, verify —
through the existing `submitRule` / `pollRuleStatus` client code and the
existing `writeRuleFile`, against demo endpoints that mirror the mainline
shapes:

```
POST /cli/api/demo/rule            -> { ruleId, status }
GET  /cli/api/demo/rule/{ruleId}   -> { ruleId, status, rules[] }
```

Mirroring is the point. A bespoke demo payload would exercise a path no user is
on, which is the one thing a demo must not do. Reusing the well-known formats
means the demo also covers polling and the terminal `failed` / `unsupported`
states rather than a happy path built for the occasion.

**The demo stops where the gate does, and says so.** A runtime rule executes
only when an authenticated reconcile returns its signature in `run`. The demo
is unauthenticated, so it reaches a complete, well-formed, verified rule on
disk and no further. `check` already explains that state: "not authenticated —
runtime rules were not verified and did not run."

**No client-side bypass.** Not for a known demo id, not behind a flag of its
own. The signature gate is what stands between a downloaded payload and
arbitrary code execution on a developer's machine, and a demo is not worth a
hole in it. Executing the demo rule uses the documented
`--dangerously-run-scripts`, which prints the warning it always prints.

## Capabilities

### New Capabilities

- `cli-runtime-demo`: A deliberately-invoked path that generates, delivers,
  writes and verifies one runtime rule against a service-controlled repository,
  so the client-service seam can be shown working rather than described.

### Modified Capabilities

- `cli-agent`: The topic index is a curated list rather than every embedded
  recipe. A topic may exist and be fetchable by name while staying out of the
  index, which is already how the code behaves and is not yet stated as a
  requirement.

## Impact

- `packages/cli/src/agent/__undocumented-sample-runtime.txt` — new recipe.
- `packages/cli/src/commands/` — the demo command, reusing `submitRule`,
  `pollRuleStatus` and `writeRuleFile` rather than duplicating them.
- `packages/cli/src/api/` — the demo endpoints, alongside the existing client.
- Depends on the service half (raised as **N9** in the cross-team document).
  The endpoints are theirs to build; the shapes above are what we asked for and
  what this change assumes.
- No change to the runtime gate, to reconcile, or to `check`'s execution
  policy.
