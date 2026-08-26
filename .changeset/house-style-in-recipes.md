---
"@taskless/cli": patch
---

Hold the agent-facing recipes to the house writing style.

`packages/cli/src/agent/*.txt` is bundled into the published CLI and served by `taskless agent <topic>`, so it is text users and agents read on every authoring run. It was the largest prose surface the house-style rules did not cover. `no-em-dashes`, `no-blocklist-phrases` and `no-hedging` now reach it, and the 270 existing em and en dashes are rewritten as periods, commas, colons or parentheses depending on what each one was doing.

No instruction changed meaning. The recipe-content tests, which assert exact phrases from `route.txt`, `create-sg-rule.txt`, `create-vale-rule.txt` and others, all still pass.

Two scoping notes worth knowing for anyone widening further. These files are `.txt`, which Vale treats as plain text: there is no markdown parser, so fenced blocks and code spans are **not** skipped the way they are in a `.md` file, and command examples are checked as prose. And `create-vale-rule.txt` and `verify-rule.txt` are excluded from `no-hedging`, because both teach rule authoring through a worked example named `no-simply` and the token appears throughout as an identifier rather than as hedging.
