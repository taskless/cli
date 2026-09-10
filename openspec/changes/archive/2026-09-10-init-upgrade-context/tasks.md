# Tasks

**Delivery shape: single PR.** Agent-facing prose, one command's output, and
their tests. It touches no open branch and each part is small enough that
splitting would separate a change from the test that pins it.

## 1. `init` is the batch path; the bare invocation is the wizard

- [x] 1.1 Remove the `--no-interactive` flag and the TTY/CI detection from `initCommand`; `run` goes straight to `runNonInteractive`
- [x] 1.2 In `index.ts`, call `runWizard` directly for a bare invocation in a TTY instead of delegating to `initCommand`; name `init` (no flag) in the non-TTY preamble
- [x] 1.3 Tests: `init` under a pipe installs with no "detected non-interactive" notice; a legacy `--no-interactive` is a no-op. Drop the flag from every test argv

## 2. Init reports the upgrade

- [x] 2.1 Add an upgrade-trailer renderer in `install/upgrade-trailer.ts`, taking the changed directories, whether a migration ran, and the previous/installed versions. Return `undefined` when nothing changed, so the no-op case is decided in one place
- [x] 2.2 Reuse the reload banner's version-moved test for the `update` pointer and for counting a version move as a change
- [x] 2.3 In `runNonInteractive`, collect per-target results into a `targets` list (`dir`, `mode`, four name lists) and derive `changed` from it plus `migrated` plus the version move. Return `previousCliVersion` and `cliVersion` alongside
- [x] 2.4 Print the trailer directly after the summary, before the reload notice and the onboarding trailer; add `cliVersion`, `targets`, and `changed` to the `--json` envelope, keeping `migrated` presence-gated
- [x] 2.5 Make `writeCanonicalSkill`/`writeCanonicalCommand` compare bytes and return `{ path, changed }`, so an identical canonical file is neither rewritten nor reported. Replace the `apply-install-plan` test that pinned the unconditional rewrite
- [x] 2.6 Tests: upgrade with version move (both parts, trailer before the reload banner, onboarding trailer still last), change without version move (no `update` pointer), no-op re-install (no trailer), and the envelope fields with `changed` agreeing with `migrated`, the lists, and the version

## 3. The `agent init` recipe addresses the agent

- [x] 3.1 Rewrite `init.md` (topic v2): `init` as the primary step, the `--json` envelope, and what follows (tell the user which paths need committing, run `update` after a version move, treat a session that predates the install as holding stale skills). Keep the wizard description for a human reader under its own heading
- [x] 3.2 Keep `## Goal`, `## Preconditions`, `## Steps`, `## Errors`, `## See Also` in order so the format test still passes

## 4. The `agent` subcommand serves recipes under the directive

- [x] 4.1 Add `RecipeOptions.directive` (default `false`) and `fetchTimeDirective(invocation)`; insert it as line 2 of the header block when set. `commands/agent.ts` and the `update` command pass `true`
- [x] 4.2 Extend `stripHeader` to drop through the first blank line, keeping the first-line `# Topic:` anchor, so `header: false` removes the directive with the version
- [x] 4.3 Tests: every recipe file keeps a one-line header; the prompts export carries no directive; the served text has it as line 2 with the invocation and the stale-skill note; `header: false` strips it; parity with the export holds under `directive: true`

## 5. The skill and command say a recipe is per-task

- [x] 5.1 Add a short section to `skills/taskless/SKILL.md` stating a recipe is resolved at fetch time and each task fetches again, even for a topic already fetched in the session. Stay under the 80-line cap
- [x] 5.2 Add the same statement to `commands/tskl/tskl.md`
- [x] 5.3 Test through the installed documentation suite that both bodies contain the statement
- [x] 5.4 Replace the literal `npx @taskless/cli` in both bodies with `%(TASKLESS_CLI)s`; add `renderInvocationPlaceholder` and use it for canonical writes in place of the prose search; test that the sources carry the token and not the literal, and that an install renders it to the build's invocation

## 6. Ship

- [x] 6.1 `patch` changeset for `@taskless/cli`
- [x] 6.2 `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
- [x] 6.3 Archive the change on this PR, then run the pre-archive scenario check from CLAUDE.md against every MODIFIED requirement
