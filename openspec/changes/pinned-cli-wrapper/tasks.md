## 1. Launcher

- [x] 1.1 Add the launcher template (one source, parameterized by package name only) that reads `install.launchers` with the `install.cliVersion` fallback, runs `npx --yes <package>@<version>` with arguments passed through, sets `TASKLESS_LAUNCHER`, and passes the exit status and signals back
- [x] 1.2 Quote arguments for cmd on win32, where the spawn uses a shell
- [x] 1.3 Fail with one stderr line naming `.taskless/taskless.json` and the installer command when no version is found
- [x] 1.4 Tests: run the built launcher against a fake `npx` on `PATH` to assert the argv, working directory, environment, exit-status passthrough, fallback, and missing-version failure
- [x] 1.5 Test that the launcher's comments name its version source and contain none of "bypass", "classifier", "auto mode"

## 2. Install

- [x] 2.1 Add `install.launchers` to the manifest type and install state, keeping the other package's entry on write
- [x] 2.2 Write this build's launcher (mode 0755) in the step that writes the canonical skill; skip for `self` builds
- [x] 2.3 Rewrite a launcher whose bytes differ and name it as restored in the human summary and the `--json` envelope
- [x] 2.4 Render the skill's `%(TASKLESS_CLI)s` to the launcher path; keep stub recovery commands on the pinned invocation
- [x] 2.5 Add the project-root guidance to `skills/taskless/SKILL.md`: run from the directory containing `.taskless/`, change directory in its own call, and read "No such file or directory" from the launcher as a wrong directory, not a reason to call npx
- [x] 2.6 Tests: release and nightly installs side by side, upgrade leaves launcher and skill bytes unchanged, edited launcher restored, `self` writes none

## 3. Permissions

- [ ] 3.1 Confirm with a local run what the docs leave open: that Cursor CLI compares a path-valued `Shell(./.taskless/bin/cli.mjs)` base literally rather than by basename, and that neither Cursor surface normalizes `./`. Codex is settled from source (literal, whole-token, `./` required); drop any harness that fails and update the spec table
- [ ] 3.2 Add the launcher rule per harness beside the invocation rules, and map `cli.mjs` / `cli-nightly.mjs` to their packages when classifying Taskless rules
- [ ] 3.3 Tests: launcher rule written, not reported as an edit on upgrade, removed with its package when a harness is deselected, other package's launcher rule kept

## 4. Global trust entry

- [ ] 4.1 Extend each package's entry text to cover its own launcher from the project root
- [ ] 4.2 Read more than one string under this build's label as stale, even when one is current
- [ ] 4.3 Fold duplicates in the wizard's write: replace the first in place, remove later ones, keep the other label's and unlabelled strings in order; one `REPLACE (global):` line
- [ ] 4.4 Say in the non-interactive `SKIPPED (global):` output how many strings carry the label and that the wizard folds them
- [ ] 4.5 Update the entry tests and the installed-skill snapshot; confirm an old entry reads as stale; cover duplicates, a duplicated current entry, decline, and `--no-interactive` leaving the file byte-identical

## 5. Settings report colors

- [ ] 5.1 Recolor the shared tones: `ALLOW` green, `REMOVE` default, `REPLACE` yellow, `SKIPPED` red, in the wizard summary and in printed output
- [ ] 5.2 Print the non-interactive global outcome as a red `SKIPPED (global):` line with the entry and the installer command, replacing the warning
- [ ] 5.3 Update the summary, permission-report, and global-trust tests and snapshots

## 6. Recipes

- [ ] 6.1 Prefer an exact-match `TASKLESS_LAUNCHER` in `detectCliInvocation`; leave `@taskless/cli/prompts` untouched; add the project-root sentence to the run-each-command guidance when the invocation is a launcher
- [ ] 6.2 Rewrite the `ci` recipe to `node .taskless/bin/cli.mjs`, drop `%(PACKAGE_MANAGER_DLX)s`, require the job to supply Node, and bump the topic version
- [ ] 6.3 Tests: recipe through the launcher, through npx, and with an unexpected variable value; the `ci` recipe snapshot

## 7. Verification and release

- [x] 7.1 Confirm `./.taskless/bin/cli.mjs` runs from Claude Code's Git Bash on Windows (confirmed 2026-10-19)
- [ ] 7.2 Run the nightly's launcher once in an auto-mode session with the new global entry, as a smoke test
- [ ] 7.3 Add a `patch` changeset describing the launcher and the one-time global entry replacement
- [ ] 7.4 Run `pnpm typecheck` and `pnpm lint`
- [ ] 7.5 Archive the change on the PR
