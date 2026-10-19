## Context

See proposal.md for why. The installed skill, project permission rules, and recipes all name the CLI as `npx @taskless/cli@<version>` today. That string is baked into the build (`resolveCliInvocation`), rendered into the canonical skill, and detected again at `agent <topic>` time (`detectCliInvocation`). Permissions are already scoped per package (release and nightly keep separate rules and separate global trust entries), and the launcher follows the same split.

What a manual auto-mode probe showed on 2026-10-19 (one run per case, a single classifier sample each, so treat these as strong hints):

| Case                                                                   | Result                        |
| ---------------------------------------------------------------------- | ----------------------------- |
| `npx @taskless/cli@0.11.2 …`, no allowance                             | refused                       |
| `./.taskless/bin/cli.mjs …` (runs that npx inside), no allowance       | allowed                       |
| `node .taskless/bin/cli.mjs …`, no allowance                           | refused as an external script |
| Either launcher spelling, with an allowance naming the launcher        | allowed                       |
| The launcher, read first by the agent, with a suspicious comment added | refused                       |
| The launcher swapped to run another package, with the allowance        | allowed                       |

## Goals / Non-Goals

**Goals:**

- A launcher spelling that agents run and harnesses can allow by a fixed path, whatever the version.
- A CLI version CI reads from the project at run time, without a `package.json`.
- The release and a nightly installed side by side without either changing what the other runs.

**Non-Goals:**

- Supplying Node. A runner without Node cannot run either a launcher or npx; the `ci` recipe asks the job to bring Node.
- A container image, a pre-commit hook, or a GitHub Action. All are reasonable follow-ups for non-Node repositories, and none is needed for the launcher to work.
- Verifying the CLI package's integrity beyond what npm already does. `npx` pins the top-level package; its one runtime dependency (`tsx`) still resolves by range.
- Changing `pinned-cli.ts`. `package.json` pins still go stale and are still reported.

## Decisions

**The version is read when the launcher runs, not baked into it.** The launcher's bytes are then the same for every version, so an upgrade changes one line of `.taskless/taskless.json` and not an executable file, and the skill text no longer moves with the version. The alternative, writing the version into the launcher, gives a reviewer a self-describing diff, but every upgrade rewrites an executable that a harness allows by path, which is the file we most want to stay boring.

**One version per package, under `install.launchers`.** `install.cliVersion` is overwritten by whichever build installed last, so a launcher reading it alone would make a nightly install move the release launcher. A map keyed by package name keeps each launcher independent. The launcher falls back to `install.cliVersion` when the map lacks its package and that version is its own (a `-` means nightly, the same rule `bumpTarget()` uses). An older CLI that rewrites the manifest drops fields it does not know, and the fallback keeps the release launcher working through that.

**Agents run `./.taskless/bin/cli.mjs`; CI runs `node .taskless/bin/cli.mjs`.** The probe refused `node <path>` and allowed `./<path>`, so the agent-facing spelling is the direct one. CI has no classifier, and there `node <path>` survives a checkout without the executable bit and a Windows runner that ignores shebangs. Claude Code on Windows runs Bash through Git Bash, which honours the shebang; that is a task to confirm, not an assumption to ship.

**`.mjs`, not `.js` or no extension.** Whether a `.js` or extensionless file is ESM depends on the nearest `package.json` `"type"`, which is the user's. `.mjs` is ESM everywhere. The `#!` line is part of the language grammar (ES2023) and Node strips it.

**The launcher runs `npx --yes`, with `shell` only on win32.** On Windows `npx` is `npx.cmd`, and Node refuses to spawn a `.cmd` without a shell. Arguments pass through cmd's quoting there, which matters for paths with spaces or metacharacters; the launcher quotes each argument for cmd before handing it over. Alternatives considered: installing once into a cache with npm and then running `node <cache>/dist/index.js` directly (no shell for user arguments, but a second code path and cache management, and the probe showed the classifier does not care what the launcher runs); fetching the tarball directly (cannot resolve the per-platform ast-grep and Vale packages that `platform-binary.ts` depends on).

**The launcher announces itself through one environment variable.** `TASKLESS_LAUNCHER=./.taskless/bin/cli.mjs`. `detectCliInvocation` prefers it, so `agent <topic>` renders recipes naming the launcher. The CLI accepts only the two known paths, so the variable cannot inject text into a recipe.

**Launcher rules are added beside the invocation rules, not instead of them.** The pinned npx rule still covers stubs' recovery commands and anyone typing the npx form. The launcher rule carries no version, so it never goes stale and upgrades report no edit for it.

**Global entry cleanup runs in `init`'s trust step, not in a migration.** Migrations change `.taskless/` and run on every write path, including `--no-interactive` and CI, with nobody there to confirm. The global entry lives in the user's own settings, which the spec only lets the wizard write, under one confirmation. An unattended edit there would also be refused by the classifier when an agent runs an upgrade. The trust step already runs on every `init`, first install or upgrade, so putting the fold there gives full cleanup on every upgrade a human confirms, and a warning on every one they do not.

**`init` restores an edited launcher and says so.** The probe showed an allowance on the path trusts whatever the file contains. `init` cannot prevent a malicious edit landing in a repository, and the CLI cannot reliably check the launcher that started it, since a tampered launcher need not start the real CLI. Restoring on every install and naming it in the summary is the defence that fits; code review is the rest.

## Risks / Trade-offs

- [The classifier's judgment is sampled once per case] → The global entry names the launcher explicitly, so the decision does not rest on the unallowed case passing.
- [An agent whose shell is not at the project root cannot run `./.taskless/bin/cli.mjs`] → The skill already requires each Taskless call to start its own line from the project root; keep that wording and test it against the launcher.
- [A launcher comment can get an agent refused] → The spec forbids comments that frame the launcher as a way around a check; a test asserts it.
- [Someone edits the launcher in a pull request] → `init` restores it and reports it; review catches the rest. This is the same exposure as any script in the repository.
- [Cursor CLI's `Shell(...)` and Codex's `prefix_rule` may not match a relative path] → Verify each before writing; a harness that cannot match gets no launcher rule, recorded in the spec table.
- [Global entries written before this change read as stale] → The wizard already offers `REPLACE (global):` once; no new mechanism.

## Migration Plan

No scaffold migration. The first `init` from a version carrying this writes the launcher, records `install.launchers`, adds the launcher rules, and offers to replace the global entry. Projects that never re-run `init` keep working on npx exactly as before. Rolling back to an older CLI leaves the launcher in place; it keeps working through the `install.cliVersion` fallback until that version moves to a nightly.

## Open Questions

- Whether the `hooks` recipe should also switch to the launcher now or in a follow-up. It has the same shape as `ci` but writes into tools (husky, lefthook) whose own runners may not start at the project root.
