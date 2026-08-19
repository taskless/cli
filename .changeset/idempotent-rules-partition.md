---
"@taskless/cli": patch
---

Stop the engine-partition migration from relocating a rules tree that is already partitioned.

A `.taskless/` with no `taskless.json` — a manifest that was never committed, or was deleted — reads as version 0, so every migration runs against it. Migration `0004` then applied its `rules/` → `sg/rules/` move to a tree already in the current layout, burying every rule at `.taskless/sg/rules/sg/<id>/`; `0005` scaffolded fresh empty engine directories over the gap. Nothing errored. `check` scanned a tree with no rules in it and exited 0 on a clean report, so a project that had silently stopped being checked was indistinguishable from one that passes.

`0004` now reads the shape of `.taskless/rules/` before moving it. A tree holding engine directories and no loose rule files is newer than the migration, not older, so it is left alone. A genuinely pre-`0004` tree of flat `rules/<id>.yml` files still moves wholesale, as before. And a tree holding both — an already-partitioned layout with a stray `rules/<id>.yml` beside it, as a merge-conflict leftover produces — migrates only the stray files: moving the directory to collect them would carry the partitioned rules down with it, and `0005` never brings them back, which is the same silent clean pass by another route.
