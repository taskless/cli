## Context

The wizard's tool step (`wizard/steps/locations.ts`) offers one row per install directory from `SHIM_TARGETS`. The harness catalog (`TOOLS` in `install/install.ts`) is used only for detection, and its harnesses surface in the picker only as names on the `.agents/` row, and only when detected. The install plan, the manifest (`install.targets`) and the summary are all keyed by directory, and that part works: it is the picker that hides harnesses.

## Goals / Non-Goals

**Goals:**

- Every catalog harness is a visible, checkable row whatever is detected.
- A harness used on this machine but not yet configured in this project is visible near the top, unchecked.
- Checking a harness runs that harness's own setup (today, only Codex has any beyond its directory).

**Non-Goals:**

- Writing anything outside the project because of machine detection. User-level skill directories stay untouched.
- Changing the manifest, the install plan, `update`, or `--no-interactive` selection, all of which stay keyed by directory.
- Preventing a harness from loading the skill twice when it reads another harness's directory (Cursor and OpenCode read `.claude/skills`). That is the harness's choice.

## Decisions

**Rows are harnesses; the plan stays directories.** Each row's value is a harness name (or `agents` for the generic row). A pure `resolveSelection(values, projectDetected)` maps checked rows to the directories to install into (deduplicated, in `SHIM_TARGETS` order) and the checked harness names. `buildInstallPlan` and the manifest are unchanged, so two checked rows sharing `.agents/` still produce one target.

_Alternative:_ record harnesses in the manifest. Rejected: `update` and `--no-interactive` would need a second source of truth beside detection, for no behavior the user asked for.

**A harness may prefer its own directory when the project already has it.** `ToolDescriptor` gains `ownDir`, used instead of `installDir` when the harness is detected in the project. Only Devin sets it: `installDir: ".agents"`, `ownDir: ".devin"`. Devin's docs show project skills in `.devin/skills/` and also list `.agents/skills/`; a project that already has `.devin/` gets the skill there, and Taskless never creates `.devin/` in a project without it. Since Devin is detected by `.devin/`, "detected in project" and "`.devin/` exists" coincide. `SHIM_TARGETS` gains `{ dir: ".devin", label: "Devin" }` so the plan and summary know the directory.

**Machine detection is a per-harness function of home and environment.** `ToolDescriptor.machine({ home, env })` returns candidate directories; the harness is machine-detected when any is a directory. Functions rather than signal records, because each override has a different shape (`CLAUDE_CONFIG_DIR` replaces `~/.claude`; `GEMINI_CLI_HOME` replaces the home that `.gemini` sits in):

| Harness     | Directory                                 | Override                                   |
| ----------- | ----------------------------------------- | ------------------------------------------ |
| Claude Code | `~/.claude`                               | `CLAUDE_CONFIG_DIR`                        |
| Codex       | `~/.codex`                                | `CODEX_HOME`                               |
| Cursor      | `~/.cursor`                               | `CURSOR_CONFIG_DIR`                        |
| OpenCode    | `~/.config/opencode`                      | `OPENCODE_CONFIG_DIR`                      |
| Gemini CLI  | `~/.gemini`                               | `GEMINI_CLI_HOME` (parent of `.gemini`)    |
| Crush       | `~/.config/crush`, `~/.local/share/crush` | `CRUSH_GLOBAL_CONFIG`, `CRUSH_GLOBAL_DATA` |
| Devin       | `~/.config/devin`                         | none documented                            |

`home` and `env` are injected (the wizard already carries `GlobalTrustEnvironment`), so tests use a temporary directory. Windows-only locations (`%APPDATA%\devin`) are not checked; a miss there only leaves the row in "Other harnesses".

**Claude Code has no `.agents/` row.** The issue proposed a "Claude Multi-Harness (`.agents`)" row for machines with Claude Code and a project with no Claude files. Claude Code reads `AGENTS.md` in that case but never anything under `.agents/`, so a skill there is invisible to it. Claude Code always installs into `.claude/`, and `readsAgentSkills` is unchanged.

**Sections, pre-check, hints.** `locationChoices(projectDetected, machineDetected, manifestDirectories)` stays pure and returns `{ groups, initialValues }`:

- Group order: `Detected in this project`, `Detected on this machine`, `Other harnesses`. A harness detected in both is in the first. The generic row is always in `Other harnesses`. Empty groups are omitted. Rows within a group follow catalog order.
- Pre-checked: every project-detected row; plus, for each manifest-recorded directory no pre-checked row already covers, the row that installs into it (the generic row for `.agents/`). When that leaves nothing checked, the generic row is checked, which is today's `.agents/` default.
- The section header says where a harness was detected, so the `detected`/`not detected` hints go. The only hint is `installed`, on a pre-checked row whose directory the manifest records.
- Labels name the directory the row installs into: `Codex (.agents/)`, `Devin (.devin/)` or `Devin (.agents/)`, `Other Agent Skills harnesses (.agents/)`.

`groupMultiselect` with `selectableGroups: false` renders headers that are not toggles. The empty-selection loop is unchanged.

**Codex's rule follows the selection.** `SyncPermissionsOptions.codexDetected` becomes `codex`: in the wizard, whether the Codex row was checked; in `--no-interactive`, whether Codex is detected in the project. `harnessesFor` adds Codex whenever `codex` is true, since checking Codex always selects `.agents/`. Once written, `.codex/rules/taskless.rules` makes `.codex/` exist, so later `--no-interactive` runs keep the rule.

## Risks / Trade-offs

- [The picker is longer: eight rows instead of four] → Sections put the relevant rows first; the remaining rows are below.
- [An override env var points at a file, not a directory] → Treated as not detected; it only affects which section the row is in.
- [A user checks Codex in a project without `.codex/`, so `.codex/rules/` is created] → This is the requested behavior; the summary already lists the file before confirming.
