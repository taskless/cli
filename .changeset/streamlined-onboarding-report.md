---
"@taskless/cli": patch
---

`taskless detect --json` now reports ast-grep and Vale configurations as linters (Taskless's own configuration under `.taskless/` excluded), the command-line tools on the host's `PATH` (`gh`, `git`, `jq`, and now `glab` for GitLab repositories) under `hostTools`, and an `agent` section of commands an agent may choose to run to check whether a source is usable, such as `gh auth status`. Detection still runs nothing and stays offline. `taskless info` lists `glab` among its tools too.

New `taskless report` publishes an unlisted Taskless report to tskl.es: a page showing the rules in this repository, what they were drawn from, and what they are projected to catch. With no flags it prints a draft of what the CLI knows and the facts an agent still has to supply; `--from <facts.json>` checks there are at least three working Taskless rules, withholds any fixture that looks like it holds a secret or contact detail, validates against the tskl.es schema, publishes, and records the report in `.taskless/reports/` (gitignored, since each record holds the URL that deletes it); `--delete <record>` takes a report down. The new `report` agent topic walks an agent through it. Migration 11 creates `.taskless/reports/`.

Onboarding now asks one question, "Do you want me to set up Taskless for you?", and does the rest: it mines every source it can reach, writes every rule the repository can enforce locally (always logged out), marks onboarding complete, publishes a report, sends Taskless onboarding feedback, and ends by strongly encouraging running the rules in CI. It asks anything else only when it cannot find enough rules for a report. GitLab merge requests are mined through `glab` the way GitHub pull requests are through `gh`.
