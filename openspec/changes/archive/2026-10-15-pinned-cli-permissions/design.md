## Context

Every Taskless action runs `npx <package>@<version> …`, a command that downloads and executes a package. Claude Code's auto mode, and the equivalent gates in other harnesses, block that by default. #506 and #507 taught the skill to stop, name the command, and offer remedies. A real session showed the remedies work but cost a round trip, and that the agent cannot write the permission itself: auto mode refused its edit to `.claude/settings.local.json` as self-modification. The agent handed the user a one-line command instead, and the narrow rule it wrote (`Bash(npx @taskless/cli-nightly@<pin>:*)`) let the preflight through under auto mode.

The user's position: installing Taskless at a version is an intentional choice, and that choice is what a permission rule records. The installer, which the user ran, writes it.

## Goals / Non-Goals

**Goals:**

- After `init`, an agent in any supported harness can run exactly the installed Taskless CLI without a prompt or a block.
- The rule allows nothing beyond that invocation: no other version, no other package.
- An upgrade leaves exactly one rule per harness, for the new version.
- The installer never removes or overrides anything it did not write.

**Non-Goals:**

- Allowing a different runner (`pnpm dlx`, `bunx`, `yarn dlx`). The skill names `npx`, and the rule matches the skill.
- Getting past an organization- or team-level policy. Those outrank project files by design in every harness that has them.
- Harnesses with no file-based allowlist. Cline decides per command by model judgement, with no allowlist ("Cline does not use a fixed allowlist", docs.cline.bot/features/auto-approve), and the generic `.agents/` target names no harness. Crush can allow only whole tools: its `crushrc` takes `permissions allow <tool>`, and its schema's `allowed_tools` holds bare names (`"bash"`, `"view"`) with no command scoping. Allowing `bash` approves every shell command, which this change never does. All three rely on the skill's remedies; approving in chat fits Cline's and Crush's per-command prompts.
- Trusting the workspace on the user's behalf. Claude Code and Codex ignore project allow rules in an untrusted workspace; that gate stays the user's.

## Decisions

**Releases pin themselves.** The `prod` define becomes `npx @taskless/cli@<version>`. Without it, a release has no version to scope a rule to, and a rule on the bare package name matches any version npm resolves, which is exactly the widening the skill forbids. Nightlies already pin, and nothing about them changes.

The cost is in the code that asks "is this the released build". `isProductionInvocation()` compares the define to the bare `npx @taskless/cli` today; it moves to a build-target define (`__TASKLESS_BUILD_TARGET__` or equivalent) rather than a string comparison. `pinnedSpecifier()` stops appending `@latest`, because the specifier now carries its version. Where the CLI prints a command for a human, the specifier is still the build's own, now pinned.

Alternative considered: keep releases unpinned and write `Bash(npx @taskless/cli *)`. The rule itself is narrow, since the space before `*` keeps it from matching `npx @taskless/cli@0.1.0`. But the command it allows is not: a bare `npx @taskless/cli` runs whatever version npx resolves, a cached copy or the latest release, so the rule approves a version nobody chose. Rejected.

**Two places stay unpinned on purpose.** A reference stub's recovery line keeps `npx @taskless/cli init`, because the standing `cli-init` requirement forbids stub content that varies per release and names the version-free released command as the form every build converges on; the canonical skill the stub points to carries the pin. `.taskless/README.md` names `@taskless/cli@latest` for a release, because a migration writes it once and upgrades do not rewrite it, so a pinned version there would be stale by the next release. A nightly's README keeps its pin, as it does today.

**An upgrade names stale pins in CI and hook files.** Pinning is what creates them: the `ci` and `hooks` recipes render the installed version into what they write. `init` already reports stale `package.json` pins; the same scan now reads the CI and hook files `detect` recognizes (`detect/automation.ts` owns the list), as text with the script-pin grammar, and reports them through the same notice and `pinnedCli` entry, by file and line. It never edits them, for the same reason it never edits `package.json`: a pin can be deliberate.

**`init` writes the rule, in the wizard and in `--no-interactive`.** Both are the user installing Taskless. The summary names each file and the exact rule written, on both paths.

**One writer per harness format, each using the format's word-bounded form.** From each harness's documentation:

| Harness       | Install dir  | File                                                                              | Rule                                                                                                          | Matching                                                            |
| ------------- | ------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Claude Code   | `.claude/`   | `.claude/settings.json`                                                           | `permissions.allow`: `Bash(<inv> *)`                                                                          | Space before `*` is a word boundary; also matches the bare command. |
| Cursor editor | `.cursor/`   | `.cursor/permissions.json`                                                        | `terminalAllowlist`: `<inv>`                                                                                  | Prefix, word-bounded.                                               |
| Cursor CLI    | `.cursor/`   | `.cursor/cli.json`                                                                | `permissions.allow`: `Shell(npx:<pkg>@<ver>)` and `Shell(npx:<pkg>@<ver> *)`                                  | First token is the command base; args are globbed.                  |
| OpenCode      | `.opencode/` | existing `opencode.json[c]`, root or `.opencode/`; else `.opencode/opencode.json` | object: `permission.bash["<inv> *"] = "allow"`; array: `{action:"shell", resource:"<inv> *", effect:"allow"}` | Trailing ` *` becomes `( .*)?`; anchored.                           |
| Codex         | `.agents/`   | `.codex/rules/taskless.rules`                                                     | `prefix_rule(pattern=["npx","<pkg>@<ver>"], decision="allow")`                                                | Whole argv tokens.                                                  |

**Only harnesses Taskless installs into get a rule, and the list is closed.** The table is the install targets that have a documented, file-based allowlist able to scope to one command with a word boundary. A harness joins by becoming an install target and getting a writer and its tests. The generic `.agents/` target is read by many harnesses (Devin, Gemini CLI, Grok, Crush among them), and none of them gets a rule through it: `.agents/` names no harness, so there is no file to write. Codex is the exception because it is a named row for `.agents/` and has its own rules directory; its rule is written when `.agents/` is selected and Codex is detected. Every other harness, present or future, uses piecemeal approval through the skill's remedies, with the user approving each Taskless command as it runs. Trying to cover every harness is a list that never finishes, and a wrong guess at an undocumented format writes a rule that is either inert or too wide.

**Rule placement follows each format's evaluation order.** OpenCode's object form applies the last matching rule ("last matching rule winning", opencode.ai/docs/permissions), so the key is appended after every existing key. The array form is evaluated top to bottom (confirmed by hand testing), so the entry goes first. Claude Code, Cursor, and Devin rank deny above allow regardless of order, so placement does not matter there.

**A deny that covers the invocation stops the write.** If a harness file already denies the invocation (Claude Code `permissions.deny`, Cursor deny rules, a Codex `forbidden` or `prompt` rule, an OpenCode rule that would win over ours), the installer writes nothing to that file and the summary says so. In most harnesses the deny would win anyway; in OpenCode's last-match form ours could silently override it, which is the case this rule exists for.

**The manifest records what was written; an upgrade replaces only that.** A new `install.permissions` map records, per file, the exact rule strings Taskless added. On the next `init` the installer removes those exact strings and adds the new ones. Anything else in the file, including a rule the user wrote for Taskless themselves, is untouched. A file Taskless created and that holds nothing but its own rule is deleted when the rule is removed; a file that existed before is never deleted.

**Edits preserve the file.** JSON files are parsed and re-serialized with their existing indentation. OpenCode's `.jsonc` keeps its comments, which needs a JSONC editor rather than `JSON.parse` (`jsonc-parser`'s `modify`/`applyEdits`). A file that does not parse is left alone and reported, never overwritten.

**The skill's remedies stay.** The preflight still runs, and its blocked-command guidance still applies. It now covers the cases the install cannot: an untrusted workspace, a harness with no permission file, a rule the user deleted, and a harness that drops the rule.

## Risks / Trade-offs

- [Auto mode drops "package-manager run commands" from allow rules on entry] → The docs give no `npx` example, so this was hand-tested: a pinned rule in place before launch survives. A rule added mid-session was not part of that test.
- [Workspace trust] → Claude Code and Codex ignore project allow rules until the workspace is trusted, and Claude Code always ignores them under `-p` and the SDK. The skill's remedies cover it.
- [Codex `allow` runs the command outside the sandbox] → Broader than "no prompt", and accepted: the rule is one pinned `npx` invocation the user installed.
- [Cursor: a non-empty `terminalAllowlist` reportedly disables "Auto-review (with Sandbox)"] → Forum report, not documented. Writing it may change a user's run-mode options.
- [Shared files touch the whole team] → `.claude/settings.json` and its peers are committed, so every teammate gets the rule. That matches `.taskless/` itself being committed: the team chose the version together.
- [The rule matches only `npx`] → An agent that swaps in `pnpm dlx` or prefixes an environment variable is not matched, and falls back to the skill's remedies.

## Resolved

- **Shared files.** Rules go in each harness's committed project file (`.claude/settings.json`, not `settings.local.json`, and the committed equivalents elsewhere), so the whole team gets the rule along with the committed `.taskless/`. The installer edits those files directly, which is why every edit merges, preserves comments, and touches only what it recorded.
- **Claude Code auto mode keeps the rule.** Hand-tested: a correctly scoped `Bash(npx @taskless/cli-nightly@<pin> *)` in place before Claude Code launches survives auto mode, and `agent ok` runs without a block.
- **Codex matches the pinned version only.** Checked with `codex execpolicy check` (codex-cli 0.156.1) against `prefix_rule(pattern = ["npx", "@taskless/cli@0.12.0"], decision = "allow")`: `npx @taskless/cli@0.12.0` with or without arguments is allowed; `@0.12.01`, `@latest`, the unpinned `@taskless/cli`, and `@taskless/cli-nightly@0.12.0` match nothing.
