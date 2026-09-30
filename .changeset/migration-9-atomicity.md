---
"@taskless/cli": patch
---

Scaffold migration `9` — the one that renames a rule id held by more than one engine — now survives being interrupted, and no longer double-suffixes a fixture you had already named `<id>-sg-…`.

Migration 9 has not been in a released version, so nothing on disk anywhere was produced by the old behaviour and there is no repair step to run. `latest` is `0.11.2`, tagged 2026-09-19; the migration landed 2026-09-22.

**It could not resume.** It renamed the rule directory first and then chased the files inside it, but renaming the directory is what resolves the collision, and the migration returns early when no collision is left. So a run that died in between — a `Ctrl-C`, a full disk, an editor holding a file open — left `sg/no-eval-sg/` containing `no-eval.yml` with `id: no-eval` and fixtures still under the `no-eval-` prefix. `verify` reported that as broken, and running `taskless init` again fixed nothing, because every later run found no collision and returned.

The order is reversed: the rule file, its `id:` field, the `.tests/` fixtures and a Vale rule's `.vale.ini` are all rewritten under the old directory name, and the directory rename is the last thing to happen. A directory rename is a single atomic operation, so it is the moment a rule is done. A rule interrupted before it still collides and is picked up by the next run; a rule interrupted after it is already whole. Each inner step also tolerates having already run, and every file rewrite is committed by renaming a temporary sibling, so an interrupted write cannot truncate a rule file.

One asymmetry can survive an interruption. Where `sg` and `vale` both hold an id, a complete run moves both and neither keeps the bare id. If a run is interrupted between the two halves, the half that finished keeps its suffix and the other keeps the bare id, because the collision it would have been renamed for is gone. The tree is collision-free and every rule is internally consistent; only the symmetry is lost. Rename it yourself if you want the pair to match.

**A fixture already named `<id>-sg-…` is no longer renamed again.** The predicate picking fixtures to rename matched every name it produced, so `no-eval-sg-basic-test.yml` in `sg/no-eval/.tests/` came out as `no-eval-sg-sg-basic-test.yml` on the first run. Such a fixture is already at the right prefix, so it now keeps its name and only its `id:` field follows — which still matters, since ast-grep attributes cases by the `id:` inside the file and a stale one reads as a rule that shipped no cases.
