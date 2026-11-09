---
"@taskless/cli": patch
---

Recipe fixes for agents and for `@taskless/cli/prompts` consumers:

- With `mechanics: false`, the `create-sg-rule`, `create-vale-rule` and `create-runtime-rule` prompts now cite other recipes by topic name, as `route` already did, instead of as `<taskless-cli> agent <topic>` commands a caller with no CLI cannot run.
- The custom-rule threshold the legacy-rule recipes and `route` quote now comes from the same constant the detector uses, so the two cannot disagree.
- `create-runtime-rule` now covers four ast-grep capture gotchas: `TypeScript` and `Tsx` are separate languages, `foo($A, $$$)` does not match a one-argument call, and where a chained-call or `jsx_text` match starts. The reference runtime rule also captures `.tsx` files and its `Match` type declares `text`.
