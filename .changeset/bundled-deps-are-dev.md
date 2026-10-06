---
"@taskless/cli": patch
---

Installing `@taskless/cli` no longer downloads the JavaScript libraries its build already bundles into `dist/` (zod, yaml, citty, @clack/prompts, posthog-node and seven others). They are now `devDependencies`. The only runtime dependency left is `tsx`, which the CLI locates and spawns to run runtime rules, plus the platform's ast-grep and Vale binaries through `optionalDependencies`, unchanged.
