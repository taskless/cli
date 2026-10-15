## 1. One .agents row that names its harnesses

- [x] 1.1 Detect Gemini CLI and Crush; mark the harnesses that read `.agents/skills`
- [x] 1.2 Collapse the catalog to one row per directory and drop `uniqueShimTargets()`
- [x] 1.3 Label the `.agents/` row from detection, falling back to every known reader; OpenCode is named but does not pre-check it
- [x] 1.4 Update the `init` recipe's tool list
- [x] 1.5 Tests for the label, pre-check, and detection
- [x] 1.6 Changeset; run `pnpm typecheck` and `pnpm lint`
