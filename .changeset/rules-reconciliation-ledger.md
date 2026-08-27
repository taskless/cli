---
"@taskless/cli": minor
---

`taskless update` now tells an agent what an upgrade changed for the rules already in a project, and records when that work is done.

**BREAKING for anyone scripting `taskless update`.** It used to mean "reinstall the skills non-interactively", which is what `taskless init --no-interactive` already does through the same code path, and what running `taskless` does on its own. Scripts relying on the old behavior should call `taskless init --no-interactive`.

The word is reclaimed for the job an agent actually needs. Running the CLI migrates the `.taskless/` layout and refreshes skills: that is the directory, and it is automatic. No migration can rewrite the rules themselves, and a rewriter that now requires a `fix`, or a rule whose matching semantics shifted under a new engine, is a question about content. An agent that has run a migration and watched it succeed will otherwise reasonably conclude the upgrade is finished.

`taskless update` with no flags serves a ledger: one section per release, in order, saying what that version means for existing rules. Sections are cumulative, and a version with nothing to do says so explicitly, because an agent cannot tell "nothing here" from "nobody wrote this". The first entry covers 0.11.0: the newly required `fix` on rewriters, Markdown's block-only grammar and its two opposite failure shapes, `sg run --lang` accepting alias spellings, and the matching-semantics changes that alter what a valid rule matches with no error at all.

`taskless update --reconciledTo=<version>` records that the walk finished, in a new `rules` section of `.taskless/taskless.json` alongside the existing `install`. It stores the CLI version and the ast-grep and Vale versions the rules are now valid against.

The two namespaces are separate because they drift. `install` records how the scaffold got here and moves on a skills refresh; `rules` records what the rules are valid against and moves only on a completed reconciliation. Keying rule work off `install.cliVersion` would let an agent skip entries it never performed, and it would fail quietly: the walk would report nothing to do while the rules stayed wrong.

The version is validated rather than trusted. A value ahead of the installed CLI is rejected, since this build carries no entries for it, and the marker is never moved backwards.

`taskless info --json` reports both namespaces, so an agent reads where to start from the same payload it already fetches.
