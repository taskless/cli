---
"@taskless/cli": patch
---

Name Codex in the install picker, so Codex users can see that it supports them.

Codex has always been detected and installed into `.agents/`. The tool-selection
step just never said so: it read `Claude Code / Cursor / OpenCode / Agent
Skills`, and the entry that serves Codex is the one whose label only makes sense
if you already know `AGENTS.md` is the file Codex reads. A GPT-centric founder
looked at that list and concluded we did not support GPT. He was wrong, and the
list is why he thought it. Somebody who believes their harness is unsupported
does not file a bug, they leave.

The picker now offers a `Codex` row alongside the generic `Agent Skills` row,
both pointing at `.agents/`. Two rows for one directory is deliberate: people
scan a list for the name of the tool they use, and `Agent Skills` still has to
be there for anyone on a harness the catalog does not enumerate. Neither label
is redundant, so neither one goes.

That makes the catalog a list of rows rather than a list of directories, which
was an assumption the code held in three places. A single `.agents/` selection
used to match one row; it now matches two, and would have been pre-checked
twice, planned twice, written twice, and reported twice in the install summary.
The pre-checked set, `detectSelectedDirectories`, and the install plan all
collapse the catalog on `dir` first. The dedupe is on the directory rather than
on the Codex row specifically, so the next pair of rows that share a
destination inherits it instead of reintroducing the bug. Ticking either row
selects `.agents/` once, and ticking both is the same install as ticking one.
