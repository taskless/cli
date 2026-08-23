## Why

`onboard` asks the agent to synthesize a bullet list of rule candidates
before anything has established what this repository can actually
enforce. The recipe forwards to `route` only at materialization time,
per accepted bullet — so the list the user chooses from is authored
blind to the destination criterion and to `detect`'s answer about the
repo's linters, languages, and rule styles.

The cost lands on the user, not the agent. They pick from a list, and
discover only afterwards that a candidate has nowhere to go — after
they have already spent the attention that a short, well-ordered list
was supposed to save.

## What Changes

- **`onboard` reads the routing surface before it proposes anything.** A
  new step 2 fetches `taskless agent route` for the criterion and runs
  `detect --json` for the repository's facts, and says plainly that the
  destination _command_ is still chosen per bullet later.
- **Each candidate bullet carries a provisional destination** —
  `- <kebab-case-name> [<destination>]: <description>`, where
  `<destination>` is one of `legacy`, `sg`, `vale`, `runtime`. The
  annotation is what makes an unroutable candidate visible while it is
  still cheap to drop.
- **The criterion is not copied into `onboard`.** `route.txt` states that
  the comparison is made there and only there, and the `engine-selection`
  removal recorded in `cli-agent` is what a duplicated criterion costs.
  This change adds a fetch, not a second copy.
- **Corrects stale prose in the `cli-onboard` spec**, which still directs
  materialization at `npx @taskless/cli help rule create` — a command
  that no longer exists under that name, and a destination the recipe
  itself stopped using when it moved to `route`.

**Delivery is a single PR.** The change is recipe text plus a spec delta;
no TypeScript, nothing that can be half-landed.

## Capabilities

### Modified Capabilities

- `cli-onboard`: the recipe establishes the routing surface before
  proposing candidates, and each proposed candidate carries the
  destination it would route to.

## Impact

- **Modified**: `packages/cli/src/agent/onboard.txt` (topic v1 → v2).
- **Unchanged**: `packages/cli/src/agent/route.txt` — the criterion stays
  where it is, and this change deliberately adds no second copy of it.
- **Modified**: `packages/cli/test/onboard.test.ts` gains a `describe`
  block pinning the route-first ordering, the annotated bullet format,
  and the absence of `route`'s destination table. The recipe text is
  materially more pinned after this change than before it — the
  existing assertions checked only the header and `## Goal`.
- **Unchanged**: all TypeScript under `src/`. No test pins the topic
  version, so the `v1 → v2` bump breaks nothing.
- **Out of scope**: surfacing whether `sg` and `vale` are actually
  resolvable on the host. `detect --json` reports `linters` /
  `languages` / `ruleStyles` and says nothing about engine
  availability, while `route.txt` asks the agent to "choose an engine
  whose availability you can assert" — real drift, but a schema change
  to `detect` and a separate proposal.
- **Out of scope**: `packages/cli/test/fixtures/route-eval.json`, whose
  `routes` list is still the three-destination set and no longer matches
  `route.txt`. Pre-existing; unrelated to this change.

**Tracking:** taskless/cli#140
