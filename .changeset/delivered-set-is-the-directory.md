---
"@taskless/cli": patch
---

A delivered file set now defines what a rule directory contains, rather than being merged into it. Writing a rule removes any file the set does not name, so `check`'s repair of a drifted rule no longer leaves behind a stray capture that reconcile never reported and the repair never replaced. Test fixtures under `.tests/` are kept: nothing there reaches an engine, and the CLI writes fixtures there itself that no delivered set names.
