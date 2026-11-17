---
"@taskless/cli": patch
---

`taskless report` now credits a rule's evidence beyond review comments. The facts file takes optional `sources` and `evidence` on every rule: the kinds of source the rule came from (`agent-files`, `conventions`, `docs`, `tests`, `reviews`, `commits`, `issues`) and how many times each one called for it. The CLI passes them to tskl.es unchanged, and refuses by rule and field what tskl.es would refuse. The publish summary gives each rule its totals, "N times in reviews" and "N times in conventions", as the report page does. Onboarding now tallies these while it mines, so a rule chosen from repeated fix-up commits, docs or tests no longer publishes as raised in zero reviews. Facts without the new fields publish exactly as before.
