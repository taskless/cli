---
"@taskless/cli": patch
---

`taskless agent <topic>` now prints a long topic as an outline that fits one agent tool call: its steps, then a list of sections it serves on request. Print one with `taskless agent <topic> --section <name>`, or the whole recipe with `--full`. Reference material such as quirk tables, engine reach lists, input schemas and the `update` ledger entries moved into those sections, so an agent harness that cuts long output no longer drops the middle of a recipe. `taskless onboard` and `taskless update` print the same outline. `@taskless/cli/prompts` still renders whole recipes.
