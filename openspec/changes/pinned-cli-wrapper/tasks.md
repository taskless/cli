## 1. Launcher

- [ ] 1.1 Add the launcher template (one source, parameterized by package name only) that reads `install.launchers` with the `install.cliVersion` fallback, runs `npx --yes <package>@<version>` with arguments passed through, sets `TASKLESS_LAUNCHER`, and passes the exit status and signals back
- [ ] 1.2 Quote arguments for cmd on win32, where the spawn uses a shell
- [ ] 1.3 Fail with one stderr line naming `.taskless/taskless.json` and the installer command when no version is found
- [ ] 1.4 Tests: run the built launcher against a fake `npx` on `PATH` to assert the argv, working directory, environment, exit-status passthrough, fallback, and missing-version failure
- [ ] 1.5 Test that the launcher's comments name its version source and contain none of "bypass", "classifier", "auto mode"

## 2. Install

- [ ] 2.1 Add `install.launchers` to the manifest type and install state, keeping the other package's entry on write
- [ ] 2.2 Write this build's launcher (mode 0755) in the step that writes the canonical skill; skip for `self` builds
- [ ] 2.3 Rewrite a launcher whose bytes differ and name it as restored in the human summary and the `--json` envelope
- [ ] 2.4 Render the skill's `%(TASKLESS_CLI)s` to the launcher path; keep stub recovery commands on the pinned invocation
- [ ] 2.5 Tests: release and nightly installs side by side, upgrade leaves launcher and skill bytes unchanged, edited launcher restored, `self` writes none

## 3. Permissions

- [ ] 3.1 Verify against each harness's documentation or a local run that Cursor CLI `Shell(./.taskless/bin/cli.mjs)` and Codex `prefix_rule(pattern=["./.taskless/bin/cli.mjs"])` match a relative-path command; drop any that cannot and update the spec table
- [ ] 3.2 Add the launcher rule per harness beside the invocation rules, and map `cli.mjs` / `cli-nightly.mjs` to their packages when classifying Taskless rules
- [ ] 3.3 Tests: launcher rule written, not reported as an edit on upgrade, removed with its package when a harness is deselected, other package's launcher rule kept

## 4. Global trust entry

- [ ] 4.1 Extend each package's entry text to cover its own launcher from the project root
- [ ] 4.2 Read more than one string under this build's label as stale, even when one is current
- [ ] 4.3 Fold duplicates in the wizard's write: replace the first in place, remove later ones, keep the other label's and unlabelled strings in order; one `REPLACE (global):` line
- [ ] 4.4 Say in the non-interactive warning how many strings carry the label and that the wizard folds them
- [ ] 4.5 Update the entry tests and the installed-skill snapshot; confirm an old entry reads as stale; cover duplicates, a duplicated current entry, decline, and `--no-interactive` leaving the file byte-identical

## 5. Recipes

- [ ] 5.1 Prefer an exact-match `TASKLESS_LAUNCHER` in `detectCliInvocation`; leave `@taskless/cli/prompts` untouched
- [ ] 5.2 Rewrite the `ci` recipe to `node .taskless/bin/cli.mjs`, drop `%(PACKAGE_MANAGER_DLX)s`, require the job to supply Node, and bump the topic version
- [ ] 5.3 Tests: recipe through the launcher, through npx, and with an unexpected variable value; the `ci` recipe snapshot

## 6. Verification and release

- [ ] 6.1 Confirm `./.taskless/bin/cli.mjs` runs from Claude Code's Git Bash on Windows, or record the gap in the skill
- [ ] 6.2 Repeat the manual auto-mode probe against a nightly build: launcher allowed with the new entry, npx form unchanged
- [ ] 6.3 Add a `patch` changeset describing the launcher and the one-time global entry replacement
- [ ] 6.4 Run `pnpm typecheck` and `pnpm lint`
- [ ] 6.5 Archive the change on the PR
