## Why

The `onboard` recipe tells an agent to probe for tooling the CLI has
already answered for, and assumes one specific issue tracker.

Three defects, all in `packages/cli/src/agent/onboard.md`:

1. **It assumes `gh`, in prose only.** Step 3 offers PR-review mining
   "only if the `gh` CLI is available. Probe with `command -v gh`", and
   step 4 repeats the probe. Nothing in `src/**/*.ts` invokes or probes
   `gh`; the instruction spends an agent turn on a question the CLI can
   answer for free, and answers it worse — `command -v gh` says nothing
   about whether the repository has pull requests to mine at all.
2. **It names Linear.** Step 3's issue-tracker bullet reads "(Linear,
   Jira, GitHub issues via `gh issue list`, etc.)". A menu that names one
   vendor first reads as a recommendation. The CLI cannot see the agent's
   MCP roster, so which tracker is reachable is the agent's judgement and
   the recipe should stop pre-empting it.
3. **A non-GitHub repository is offered PR mining anyway.** `gh` on
   `PATH` is not the same question as "this repository has pull
   requests". A repo on GitLab with `gh` installed gets offered a scan
   that cannot return anything.

Separately, `info --json`'s `tools` key means _agent harnesses_ (Claude
Code, Codex, Cursor, OpenCode). That is the wrong noun for the payload
and it occupies the name the new detection wants.

## What Changes

- **New leaf module `packages/cli/src/detect/host-tools.ts`.** It reports
  presence of `gh`, `git` and `jq` by asking whether a file of that name
  sits on `PATH` (`findOnPath`, which `existsSync`es and executes
  nothing), and marks `gh` **not applicable** when
  `resolveRepositoryContext(cwd).ghOwner` is the `[unknown]` sentinel.
- **`info --json` renames `tools` to `harnesses`.** The array is
  unchanged; only the key moves. `tools` is then re-introduced carrying
  the detected CLI binaries. This is the consumer-visible part of the
  change.
- **A general recipe variable mechanism.** `RecipeOptions.hostTools`
  carries the detected state into the renderer, which substitutes whole
  blocks — including their grammatical connectives — exactly as
  `DETECT_EVIDENCE` and `LOGIN_EVIDENCE` already do. `onboard` is the
  only consumer in this change; the mechanism is not onboard-specific.
- **`onboard.md` step 3 and step 4 rewritten.** The source menu states
  presence and never verification ("`gh` is on your PATH; Taskless did
  not run it"), the issue-tracker bullet names Jira and Linear as
  examples of a class rather than a default, and step 4 reports what was
  found instead of telling the agent to re-probe.
- **An omitted source says why it is omitted, in one line.** Mirroring
  `route.md`'s reasoning for the dropped remote tier: a reader who is not
  told reads the omission as an oversight and asks for it, which costs a
  turn. Precedence is `not-applicable` over `absent`: a non-GitHub
  repository is told there are no pull requests to mine, not that `gh` is
  missing, and is not offered PR-comment mining even with `gh` installed.
- **`@taskless/cli/prompts` is unaffected by default.** With no
  `hostTools` supplied the renderer emits the recipe's full menu, so a
  Worker consumer with no `PATH` keeps a complete recipe.

### Explicitly not built: verification

Presence only. Taskless never spawns a detected binary and never hashes
it. A sha256-against-known-releases tier was considered and measured as
intractable: GitHub publishes checksums for `gh`'s release _archives and
installers_, not for the extracted binary, and the local Homebrew `gh`
2.97.0 matched **0 of 21** official digests. A verification tier that
cannot verify the common install path is worse than no tier, because its
"unverified" verdict would read as "suspicious" rather than "unknown".

Nothing here is **BREAKING** in the semver sense. The package is
`0.y.z`, where semver puts added surface outside the stability
guarantee, so the bump is `patch`. The `tools` → `harnesses` rename is
still the thing a release note must lead with.

## Non-goals

- No version, no `--version` call, no hash, no "is this really `gh`"
  check of any kind.
- No MCP detection. The CLI cannot see the agent's MCP roster and will
  not guess at it; whether a bug tracker is reachable stays a judgement
  the agent makes at runtime.
- No new subcommand. `info` already reports capability state and is
  already JSON.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli`: the `info --json` payload requirement, for the `tools` →
  `harnesses` rename and the new `tools` array.
- `cli-onboard`: the recipe-content requirement (source menu and tool
  probing), and the `onboard.txt` → `onboard.md` filename drift left
  behind by the Vale-coverage change.
- `cli-agent`: the sprintf named-argument requirement, for the host-tool
  variables, and the same `.txt` drift in one scenario.
- `cli-knowledge-prompts`: one new requirement for the `hostTools`
  option and its full-menu default.

## Impact

- `packages/cli/src/detect/host-tools.ts` (new): detection.
- `packages/cli/src/schemas/info.ts`: `harnesses`, plus the new `tools`.
- `packages/cli/src/commands/info.ts`: populate both; human output.
- `packages/cli/src/prompts/recipes.ts`: `hostTools` option, the
  whole-block variables.
- `packages/cli/src/agent/onboard.md`: steps 3 and 4; topic v3 → v4.
- `packages/cli/src/commands/onboard.ts`, `packages/cli/src/commands/agent.ts`:
  detect and pass, at the point `invocation` is already detected. Both
  serving paths must compute the same state or byte-parity breaks.
- `packages/cli/src/agent/info.md`: the example payload.
- `packages/cli/test/`: `host-tools.test.ts` (new), plus updates to
  `cli.test.ts` for the renamed key.

## Delivery shape

**Single PR.** Detection, the rename, the recipe rewrite, the spec
deltas and the tests are one reviewable diff and are only correct
together: renaming `tools` without adding its replacement, or rewriting
the recipe without the detection behind it, would each ship a broken
intermediate state.
