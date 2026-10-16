## Context

`install/permissions.ts` writes one rule set per harness into project files, driven by `syncPermissions`, and decides what to remove from the manifest's `install.permissions` record: it removes exactly what it recorded and nothing else. The wizard calls it twice, once with `write: false` to preview in the summary step and once to write; `--no-interactive` calls it once and prints the edits afterwards. The skill body source is `skills/taskless/SKILL.md`, 121 lines against a 150-line cap enforced in `installed-documentation.test.ts`.

Claude Code's auto mode reads `autoMode.{environment,allow,soft_deny,hard_deny}` as prose lists from user settings, where `"$defaults"` inside a list splices in the shipped entries. `claude auto-mode critique` reported "No custom auto mode rules found" when the section lived in a project's `.claude/settings.json`, which confirms the project file is not read for it.

## Goals / Non-Goals

**Goals:**

- One Taskless rule per project permission file, regardless of how earlier rules got there.
- A shape for user-level trust that a second harness can join by adding one entry, without touching `syncPermissions` or the wizard.
- No path by which a non-interactive or agent-driven `init` writes outside the project.

**Non-Goals:**

- Codex. Its guardian auto-review appears to review only commands that would otherwise prompt, so a matching `prefix_rule` allow, which `init` already writes, should pre-empt it. That claim comes from third-party write-ups that disagree on config key names; it is not verified, so Codex does not join the table until it is.
- Removing the global entry on uninstall. It names no repo and covers every Taskless project the user has, so one repo's uninstall is not a reason to remove it.
- Proving the entry clears the classifier. That is a judgement by a model and cannot be tested in CI; see Risks.

## Decisions

**Recognize Taskless rules by pattern per harness, not by the record.** Each `Harness` gains `found(text): string[]`, returning every Taskless allow rule in its file, written the way its `edit` takes them in `remove`, and matching its own format: Claude `Bash(<cmd> *)` and `Bash(<cmd>:*)`; Cursor editor `<cmd>`; Cursor CLI `Shell(npx:<spec>)` and `Shell(npx:<spec> *)`; OpenCode object keys and array resources; Codex `prefix_rule` patterns. `<cmd>` is `npx` or `pnpm dlx` followed by `@taskless/cli` or `@taskless/cli-nightly`, with or without an `@<anything>` suffix. Each harness's `edit` already receives a `remove` list, so `syncPermissions` reads every file first and computes `remove` as `found` minus the wanted rules, instead of the recorded rules minus the wanted ones. The record still supplies `created`, for the delete-when-empty rule. _Alternative:_ keep the record as the authority and add a one-time migration that adopts existing Taskless rules into it. Rejected: it only fixes rules present at migration time, and the skill's fallback can add a new unrecorded rule at any point.

Deny-shaped entries are never found, because `found` reads only allow lists (Claude `permissions.allow`, Cursor `terminalAllowlist` and `permissions.allow`, OpenCode `"allow"` values and `effect: "allow"`, Codex `decision="allow"`).

**A separate `GlobalTrust` interface, not another `Harness`.** It has a different lifecycle: it is not recorded, not versioned, is written at most once, and is never removed. Folding it into `Harness` would put conditionals for all four through `syncPermissions`. Shape:

```ts
interface GlobalTrust {
  harness: string; // "Claude Code"
  selectedBy: string; // ".claude"
  path(environment: { home; env }): string; // honours CLAUDE_CONFIG_DIR
  key: readonly string[]; // ["autoMode", "allow"]
  seed: readonly string[]; // ["$defaults", entry], for a new list
}
```

Detection and the edit are shared, not per harness: an entry is present when the list holds a string starting with the label, and the edit appends the entry, or writes `seed` when the list is absent. `syncGlobalTrust({ selected, write, environment })` returns one outcome per applicable entry: `present`, `absent`, `written`, or `skipped` with a reason. `environment` defaults to the real home directory and `process.env`; tests pass their own, and the spawned-CLI tests set `HOME`, so no test reaches the real home directory. `GLOBAL_TRUST` is a one-element list; joining it is the only change a second harness needs.

**The entry text**, fixed in source and identical across versions:

> Taskless CLI: The npm packages @taskless/cli and @taskless/cli-nightly are tooling published by Taskless via npm trusted publishing (OIDC), installed by the user through the Taskless installer. Running either via npx or pnpm dlx is allowed only when the call names an exact version (e.g. @taskless/cli@1.2.3). Dist-tags such as @latest or @nightly, version ranges, and unversioned calls are not covered.

It follows the shipped entries' `Name: description` form, which is also what makes label detection possible. The example version is deliberately fake so the text never ages.

**`$defaults` only when creating the list.** An existing list without it is a choice the user made, to replace the defaults; adding it back would widen what their classifier allows. Edits go through the same `jsonc-parser` edit path as the project files, so formatting and comments survive.

**Two confirmations in the wizard.** The project confirm already exists. The global one comes after it, as its own `confirm`, so a user who wants the repo set up but not their home directory touched can say so without abandoning the install. Its default is yes, matching the project confirm.

**The warning is computed after writing.** Both modes call `syncGlobalTrust` read-only after the install and warn for each `absent` outcome, which covers non-interactive, declined, and skipped alike with one code path.

## Risks / Trade-offs

- [The classifier ignores or misreads the entry] → The entry is guidance to a model, not a rule. Mitigation: the skill's fallback still handles a refusal, and it now gives the entry inline, so a user without it, or with a wording that does not land, still gets a path. The wording can change without a migration because detection is by label; existing users keep the old text, which is acceptable since it is still a valid entry.
- [Pattern removal deletes a Taskless rule the user wanted] → By decision, one line per file and it is the installed one. Every removal is shown as `REMOVE:` in the wizard preview before anything is written.
- [A recognizer is too broad and removes a non-Taskless rule] → The command must be `npx` or `pnpm dlx` immediately followed by one of two exact package names; tested per harness with near-misses (`@taskless/cli-foo`, `npx -y @taskless/cli`, other packages).
- [Writing to `~/.claude/settings.json` races a running Claude Code session] → Claude Code rewrites its settings file itself. Mitigation: read-modify-write in one step, immediately after the confirm, through a minimal `jsonc-parser` edit rather than a re-serialization.
- [The skill body grows] → About 15 lines against 29 lines of headroom under the cap.

## Migration Plan

None beyond the release. The first `init` after upgrading removes stale Taskless rules and shows them as `REMOVE:` lines. Rollback is a downgrade; stale rules removed by the new version are not restored, which is the intended state anyway.
