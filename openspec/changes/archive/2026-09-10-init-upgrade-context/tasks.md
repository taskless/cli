# Tasks

**Delivery shape: single PR.** Agent-facing prose, one command's output, and
their tests. It touches no open branch and each part is small enough that
splitting would separate a change from the test that pins it.

## 1. Non-interactive init reports the upgrade

- [x] 1.1 Add an upgrade-trailer renderer beside `getOnboardTrailer`, taking the changed directories, whether a migration ran, and the previous/installed versions. Return `undefined` when nothing changed, so the no-op case is decided in one place
- [x] 1.2 Reuse the reload banner's version-moved test for the `update` pointer, rather than writing a second comparison next to it
- [x] 1.3 In `runNonInteractive`, collect per-target results into a `targets` list (`dir`, `mode`, four name lists) and derive `changed` from it plus `migrated`. Return `previousCliVersion` and `cliVersion` alongside so the caller does not re-read state
- [x] 1.4 Print the trailer after the reload notice and before the onboarding trailer on the human path; add `cliVersion`, `targets`, and `changed` to the `--json` envelope, keeping `migrated` presence-gated as it is
- [x] 1.5 Tests: upgrade with version move (both parts, onboarding trailer still last), change without version move (no `update` pointer), no-op re-install (no trailer), and the envelope fields with `changed` agreeing with `migrated` and the lists. Update any test that pins the envelope to an exact object

## 2. The migration refusal names the right command

- [x] 2.1 In `requireCurrentSchema`'s refusal, append `--no-interactive` when `process.stdout.isTTY` is not `true`
- [x] 2.2 Test both wordings through the built CLI; the existing `no-implicit-migration` suite is the place, since it already runs `check` against a behind-the-CLI fixture with a piped stdout

## 3. The init recipe addresses the agent

- [x] 3.1 Rewrite `init.md` (topic v2): the non-interactive invocation as the primary step, the `--json` envelope, and the three follow-ups (commit the named directories, run `update` after a version move, treat a session that predates the install as holding stale skills). Keep the wizard description for a human reader under its own heading
- [x] 3.2 Keep `## Goal`, `## Preconditions`, `## Steps`, `## Errors`, `## See Also` in order so the format test still passes

## 4. Recipes carry the fetch-time directive

- [x] 4.1 Add the directive as line 2 of every `packages/cli/src/agent/*.md`, byte-identical, using `%(TASKLESS_CLI)s agent <topic>` for the re-fetch command
- [x] 4.2 Extend `stripHeader` to drop through the first blank line, keeping the first-line `# Topic:` anchor. Verify `header: false` output contains neither the version nor the directive and that the body is byte-identical to the default rendering's body
- [x] 4.3 Add a test that every recipe's second line is the directive and third line is blank, so a new recipe cannot omit it

## 5. The skill and command say a recipe is per-task

- [x] 5.1 Add a short section to `skills/taskless/SKILL.md` stating a recipe is resolved at fetch time and each task fetches again, even for a topic already fetched in the session. Stay under the 80-line cap
- [x] 5.2 Add the same statement to `commands/tskl/tskl.md`
- [x] 5.3 Test through the installed documentation suite that both bodies contain the statement

## 6. Ship

- [x] 6.1 `patch` changeset for `@taskless/cli`, saying what an agent now sees after `init` and that recipes carry the directive
- [x] 6.2 `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
- [x] 6.3 Archive the change on this PR, then run the pre-archive scenario check from CLAUDE.md against each of the three MODIFIED requirements
