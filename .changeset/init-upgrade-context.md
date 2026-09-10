---
"@taskless/cli": patch
---

`taskless init --no-interactive` now tells an agent what an install changed and what follows. The human output gains an upgrade trailer naming the directories that hold changed files and, after a CLI version move, pointing at `taskless update`; the `--json` envelope gains `cliVersion`, a per-target `targets` summary, and a `changed` flag. A canonical file whose bytes already match the bundle is no longer rewritten or reported as written. The `SCAFFOLD_MIGRATION_REQUIRED` refusal names `init --no-interactive` when stdout is not a TTY. The `init` recipe is rewritten for the agent that runs it. Every recipe carries a fetch-time directive on its second line, stripped along with the version by `header: false`, and the skill and `tskl` command say a recipe is fetched again for each task.
