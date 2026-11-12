---
"@taskless/cli": patch
---

On a Node older than the CLI needs (`>=22.22.0`), Taskless now stops with `Taskless needs Node >=22.22.0, you have 20.19.0. Install a newer Node and run it again.` and exits 1, instead of crashing with an unrelated `SyntaxError` about `globSync`. This holds for `npx @taskless/cli` and `pnpm dlx`, whose `bin` is now a small shim that checks the version before loading the CLI, and for the project launcher (`.taskless/bin/cli.mjs`), which checks before installing a version and before running one. Launchers pick this up when `init` rewrites them. The `ci` recipe now says the job needs Node 22.22 or later.
