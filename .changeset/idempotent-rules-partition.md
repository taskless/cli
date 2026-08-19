---
"@taskless/cli": patch
---

Stop the engine-partition migration from relocating a rules tree that is already partitioned.

A `.taskless/` with no `taskless.json` — a manifest that was never committed, or was deleted — reads as version 0, so every migration runs against it. Migration `0004` then applied its `rules/` → `sg/rules/` move to a tree already in the current layout, burying every rule at `.taskless/sg/rules/sg/<id>/`; `0005` scaffolded fresh empty engine directories over the gap. Nothing errored. `check` scanned a tree with no rules in it and exited 0 on a clean report, so a project that had silently stopped being checked was indistinguishable from one that passes.

`0004` now recognizes an already-partitioned `.taskless/rules/` — every entry an engine directory, no loose rule files — and leaves it alone, because a tree in that shape is newer than the migration, not older. Recognition is strict, so a genuinely pre-`0004` project with flat `rules/<id>.yml` files still migrates as before.
