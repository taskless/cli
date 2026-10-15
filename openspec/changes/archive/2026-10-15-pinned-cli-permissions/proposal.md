## Why

Harnesses now gate commands that download and run a package. Every Taskless action is one of those, so on a fresh install the first thing an agent hits is a block. The skill's remedies (#506, #507) recover from it, but they cost the user a round trip, and the most direct remedy fails: Claude Code's auto mode refuses an agent editing its own permissions, so the agent has to hand the user a command to run.

The block is answering a question the user already answered. Installing Taskless is the user choosing to run Taskless, and choosing a version. The installer can record that choice in each harness's own project permission file, scoped to exactly that version. The CLI does the writing, not the agent, which is what the user wants and what a self-modification guard is there to distinguish.

A narrow rule works in practice: in a real auto-mode session, `Bash(npx @taskless/cli-nightly@<pin>:*)` in `.claude/settings.local.json` let the preflight through.

## What Changes

- **Released builds pin their own version.** The `prod` target bakes `npx @taskless/cli@<version>` into installed skills and rendered recipes, as `nightly` already does with `npx @taskless/cli-nightly@<version>`. A release currently names the unpinned `@taskless/cli` (and `@latest` when handed to a launcher), which no rule can scope to one version. Upgrading stays what it is today: re-running `init`.
- **An upgrade names stale pins in CI and git hooks.** Once releases pin, the `ci` and `hooks` recipes write a pinned invocation, and the next upgrade leaves it behind. `init` already reports stale pins in `package.json`; it now reads the CI and hook files `detect` recognizes as well, and recommends the version to move to, without editing them.
- **`init` writes a version-pinned allow rule** for each harness it installs the skill into, in that harness's project permission file:
  - Claude Code (`.claude/`): `.claude/settings.json`, `permissions.allow`: `Bash(<invocation> *)`.
  - Cursor (`.cursor/`): `.cursor/permissions.json` (`terminalAllowlist`) for the editor agent, and `.cursor/cli.json` (`permissions.allow`: `Shell(...)`) for the CLI agent.
  - OpenCode (`.opencode/`): the existing `opencode.json` or `opencode.jsonc`, in whichever form it already uses; the object form takes the rule last, the array form first.
  - Codex (`.agents/`, when Codex is detected): `.codex/rules/taskless.rules`, `prefix_rule(..., decision="allow")`. `allow` also runs outside Codex's sandbox, which is acceptable for one pinned `npx` invocation.
- **Harnesses Taskless does not install into get no rule.** That includes every harness that reads the generic `.agents/skills` (Devin, Gemini CLI, Grok, Crush, and more), Cline, which has no allowlist, and anything new. They use piecemeal approval through the skill's remedies: the user approves each Taskless command as it runs. The same fallback covers an untrusted workspace and a rule the user removed.
- **Every edit is announced.** `init` names each settings file it creates or edits, with a green `ALLOW: <rule>` line per rule added (and red `REMOVE:` on upgrade). The wizard shows these lines before writing.
- **The rule is never wider than the invocation.** It always uses each harness's word-bounded form, so `@0.13.0` cannot match `@0.13.01`, and never a wildcard over the package name or version.
- **The manifest records every rule Taskless wrote.** An upgrade replaces the old rule with the new one, touching only the exact entry it recorded and merging into everything else in the file. A harness file that carries an explicit deny covering the invocation is left alone and reported, since overriding a user's deny is not the installer's call.

## Delivery shape

**Stacked, merging forward.** Two PRs, each safe in production alone:

1. Release pinning, plus naming stale pins in CI and hook files. Pinning is what creates those stale pins, so the two ship together. Correct on its own: an agent runs the version that was installed, and an upgrade says what it left behind.
2. Permission writing. It depends on (1) for releases to have a version to scope to; nightlies already do.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `infrastructure`: the `prod` build target bakes a version-pinned invocation.
- `cli`: user-facing commands name the pinned release rather than `@latest`.
- `cli-init`: `init` writes, records, replaces, and reports harness permission rules.
- `skill-taskless`: the preflight treats the install's rule as the normal case, and offers only per-command approval where a harness cannot scope a rule.

## Impact

- `packages/cli/vite.config.ts`, `scripts/build-target.ts`, `src/util/invocation.ts`, `src/util/package-manager.ts`: the prod define and every check of "is this the released build", which can no longer compare the invocation to the bare `npx @taskless/cli`.
- `src/install/`: a permission writer per harness format, manifest records, upgrade replacement.
- `skills/taskless/SKILL.md`: preflight wording.
- A JSONC-preserving editor for OpenCode, likely a new dependency (`jsonc-parser`).
- Tests for each format, merge, placement, replace, deny, and the pinned invocation.
- Changesets: `patch` for each. Pre-1.0, and neither asks anything of a consumer: re-running `init` is already how an install upgrades.
