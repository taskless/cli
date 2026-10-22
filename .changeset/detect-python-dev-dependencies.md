---
"@taskless/cli": patch
---

`taskless detect` now finds a Python linter installed as a dev dependency in `pyproject.toml`, so a repository that runs ruff on its defaults, with no `[tool.ruff]` table, no longer reads as having no linter. It reads PEP 735 `[dependency-groups]` (what `uv add --dev` writes), `[tool.uv] dev-dependencies`, `[tool.pdm.dev-dependencies]`, Hatch environment dependencies, and Poetry dependency groups. Poetry groups were previously read by group name rather than by the dependencies inside them.
