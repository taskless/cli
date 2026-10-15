---
"@taskless/cli": patch
---

Released builds now pin their own version. The installed skill and the `agent` recipes name `npx @taskless/cli@<version>` instead of the unpinned `npx @taskless/cli` or `@latest`, as nightlies already did, so an agent runs exactly the version the project installed. Commands the CLI prints for you, such as an authentication remedy, are pinned the same way. Upgrading is unchanged: re-run `init`. Two places stay unpinned: a reference stub's reinstall line, so stubs do not change on every release, and `.taskless/README.md`, which is written once and read across upgrades.

`init` now also reports stale Taskless pins in CI and git-hook files (GitHub Actions, GitLab CI, CircleCI, husky, lefthook, pre-commit, and the rest of the files `detect` recognizes) by file and line, through the same notice and `pinnedCli` JSON field as `package.json` pins. It recommends the version to move to and never edits the file.

`init` now also allows exactly the installed CLI in each agent it installs for, so a harness that gates download-and-run commands lets Taskless through without a prompt: Claude Code (`.claude/settings.json`), Cursor (`.cursor/permissions.json` and `.cursor/cli.json`), OpenCode (`opencode.json[c]`), and Codex (`.codex/rules/taskless.rules`, when Codex is present). Each rule names one version and cannot match another. Every edit is announced, as `Edited <file>` with a green `ALLOW:` line, and the wizard shows it and asks before writing. An upgrade replaces only the rule Taskless recorded, a rule you wrote is never touched, and a file that denies the command or does not parse is left alone and reported. `init --json` carries the same edits under `permissions`. Agents Taskless does not install into use per-command approval through the skill.

The setup wizard's tool list now has one `.agents/` row, labelled with the detected harnesses that read it, such as `OpenCode, Codex, and other .agents harnesses (.agents/)`, instead of separate `Codex` and `Agent Skills` rows. Gemini CLI and Crush are now detected, and install the skill into `.agents/`.
