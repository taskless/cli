## 1. One approval, one question

- [x] 1.1 Rewrite the blocked-preflight guidance in `skills/taskless/SKILL.md`: one message, three remedies with the agent's own fallback kept, no "what next?"
- [x] 1.2 Go straight to the request after `agent ok`, and route a request that names no task to `agent onboard`
- [x] 1.3 Extend the preflight test

## 2. Remove the `tskl` command

- [x] 2.1 Delete `commands/tskl/`, the `commandName` frontmatter, and the plugin's `commands` entry
- [x] 2.2 Remove command writing from the installer, `init`, and the wizard; keep the manifest-driven removal, unlink a symlinked `tskl/`, and drop empty directories
- [x] 2.3 Update the `init` recipe, the README template, `.taskless/README.md`, the READMEs, and `dotagents.md`
- [x] 2.4 Update the install tests and add coverage for removing a recorded command

## 3. Release

- [x] 3.1 Correct the `agent-ok-preflight` changeset and add `remove-tskl-command`
- [x] 3.2 Run `pnpm typecheck` and `pnpm lint`
