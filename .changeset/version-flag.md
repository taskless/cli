---
"@taskless/cli": patch
---

`taskless --version` and `-v` print the version. Before, both fell through to the full usage banner, and `-v` was not recognised at all.
