---
"@taskless/cli": patch
---

Onboarding now reads Gemini CLI's `GEMINI.md` as an agent-memory source, including nested copies and any file `context.fileName` in `.gemini/settings.json` renames it to, and the report credits it under `agent-files`. Install detection of Gemini CLI from `GEMINI.md` or `.gemini/` is now covered by tests.
