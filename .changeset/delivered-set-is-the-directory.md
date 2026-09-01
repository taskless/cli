---
"@taskless/cli": patch
---

A delivered file set now defines what a rule directory contains, rather than being merged into it. Writing a rule removes any file the set does not name, so `check`'s repair of a drifted rule no longer leaves behind a stray capture that reconcile never reported and the repair never replaced. Test fixtures under `.tests/` are kept: nothing there reaches an engine, and the CLI writes fixtures there itself that no delivered set names. Neither half of that write acts through a symlink: a link standing where a delivered file belongs is unlinked rather than written through, and a rule directory that is itself a link is refused. A file the purge cannot remove is now named in the error instead of silently ending the pass.
