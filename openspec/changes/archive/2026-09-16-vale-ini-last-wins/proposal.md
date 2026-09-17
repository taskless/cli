## Why

The `cli-vale-rule-engine` spec records how Vale resolves a key assigned twice inside one matcher, "measured against Vale 3.17.1": the **first** assignment wins. Vale 3.21.0 changed that (upstream 1e4f6ed, "let the project's rule settings win"): the **last** assignment wins, the same direction that already held between two different matchers. The CLI pins Vale 3.21.0 as of `@taskless/cli` 0.11.2, its vendor contract test asserts last-wins in both orders, and `assemble.ts` says so. The spec is the one place still stating the old measurement.

The requirement's rule does not change. A disable is declared after the enable it narrows, and assembly is deterministic, because precedence is positional. That rule was written to survive either merge direction, and under last-wins it holds in every shape rather than only across matchers.

## What Changes

- The measurement in the per-rule scoping requirement moves from Vale 3.17.1 to Vale 3.21.0, and the repeated-key bullet says **last** wins, matching the between-matchers bullet.
- A new scenario pins the repeated-key direction, so the spec names the shape the vendor contract test measures rather than only the between-matchers shape.

Nothing here is **BREAKING**, and no code changes. The behaviour already ships in 0.11.2; this brings the spec to what the pinned binary does.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-vale-rule-engine`: the per-rule scoping requirement restates its precedence measurement against Vale 3.21.0 and gains a scenario for a repeated key within one matcher.
