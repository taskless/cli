---
"@taskless/cli": patch
---

A project with no recorded rules marker now walks the ledger from the beginning, and `taskless update --rules` replaces `--reconciledTo=<version>`.

Previously an absent `rules.reconciledTo` meant "nothing to walk", on the reasoning that a project created at the installed version has no history. That was right about new projects and wrong about every existing one: a project that predates the ledger has had none of its entries applied, so reading absence as up to date silently excused exactly the population the entries were written for. The 0.11.x entry would have reached nobody.

Absent now means `0.0.0`, so every section applies. New projects stay correct because `init` stamps the marker at creation, which is what makes the two distinguishable: present means accounted for, absent means predates the ledger. The stamp never overwrites an existing marker, so re-running setup cannot reset one a real walk earned.

`--reconciledTo=<version>` is replaced by the flag `--rules`, which stamps the running CLI's version. The value was never load-bearing: the CLI knows its own version, the only sensible endpoint of a walk is the installed one, and accepting a value only made it possible to claim a walk that did not finish. Removing it removes the two guards that existed to police it and every way of supplying it wrongly. The backwards guard remains, because an older CLI running on the same project would otherwise rewind the marker.

The ledger heading is now `Migrating to 0.11.x`, since the entry describes the release series rather than one patch.
