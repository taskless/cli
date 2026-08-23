## Why

A recipe that says `` `taskless agent route` `` is telling the reader to run a binary that is, for most readers, not on `PATH`. Nobody installs `@taskless/cli` globally — it is reached through `npx` or `pnpm dlx` — so the shortest correct form of that line is `npx @taskless/cli@latest agent route`, and the recipes say it 154 times in three different ways:

| Form                      | Occurrences | Where                 |
| ------------------------- | ----------- | --------------------- |
| `` `taskless <cmd>` ``    | 114         | 20 of 21 recipe files |
| `npx @taskless/cli <cmd>` | 40          | 13 recipe files       |
| `%(PACKAGE_MANAGER_DLX)s` | 6           | `ci.txt` only         |

Three spellings of one fact is a drift surface, and it is already drifting: `applyCliInvocation` rewrites only the second form, so on a `nightly` or `build:self` artifact the 114 bare occurrences keep naming a binary that build deliberately did not install. An agent reading a nightly's `route` recipe is told to run `taskless agent create-sg-rule`, which resolves to whatever `@taskless/cli` happens to be on the machine — the released package, not the nightly it is supposed to be exercising. The `dev`/`self` build notice exists to paper over exactly this, and it papers over one form out of three.

Underneath the recipes, the CLI's own answer to "how was I called" is wrong. `getCliPrefix()` (`packages/cli/src/util/package-manager.ts:8-20`) reads `npm_config_user_agent` and nothing else. Every pnpm entry point sets a `pnpm/` user agent — `pnpm run`, `pnpm exec`, `pnpm dlx`, and every lifecycle script — so a CLI invoked from a `package.json` script inside a pnpm repo tells the user to run `pnpm dlx @taskless/cli@latest auth login`. That is not how they got there and, in a repo that pins the CLI as a devDependency, not what they want. The function also hardcodes `@taskless/cli@latest`, so a nightly's error messages send the reader to the released package — the same bug the nightly build target was created to fix, in the one code path that never got the fix.

A user agent cannot answer this question. It reports which package manager is in the process tree, not which command the user typed. What distinguishes `pnpm dlx` from `pnpm run` is the path the binary was launched from: `pnpm dlx` runs out of `~/Library/Caches/pnpm/dlx/<hash>/…`, `npx` out of `~/.npm/_npx/<hash>/…`, and `pnpm run` out of the repo's own `node_modules/.bin`. `process.argv[1]` carries that, and it is the signal this change reads.

## What Changes

- **Add a `%(TASKLESS_CLI)s` sprintf variable** carrying the full invocation — launcher, package name, and version pin — and normalize all 154 hardcoded call sites in `packages/cli/src/agent/*.txt`, `skills/taskless/SKILL.md`, and `commands/tskl/tskl.md` onto it.
- **Resolve it in three steps**: an explicit `RecipeOptions.invocation`, else the build-target invocation `__TASKLESS_CLI__` when that build is not prod, else the agent-fill marker `<taskless-cli>` — matching the `<package-manager-dlx>` convention already in the renderer. A prod build that cannot tell how it was launched emits a marker rather than a guess.
- **Detect the launcher from `process.argv[1]` and the environment, as a pure function over an injected context**, the way `resolveBuildTarget` is pure over an injected `BuildEnvironment`. It answers `npx`, `pnpm dlx`, or "not confident" — and "not confident" is a first-class answer, not a fallback to npx. Yarn, bun, and global installs are deliberately not detected: they set no signal distinguishable from a bare `node` launch, and the marker is the honest answer for them.
- **Fix `getCliPrefix()`** to use that detection and to derive its package spec from the build target, so a nightly's error messages name `@taskless/cli-nightly@<version>`. Five call sites (`auth/identity.ts:29`, `auth/token.ts:121`, `api/rules.ts:40,79`, `commands/check.ts:172`) are corrected by the change with no edit.
- **Export `getInstructions` and `getRawInstructions`** from `@taskless/cli/prompts`, each returning `{ text, variables }`. `getRawInstructions` returns the unrendered template plus the list of variables it contains, so a host that knows its own package manager can render the text itself. Both throw on an unknown topic, matching `getPrompt`; `getRecipe` keeps returning `undefined` because the `agent` command and its tests depend on that.
- **Collect the variable list from sprintf's own parser, not a regex.** `sprintf-js` exports no parser, but its named-argument lookup is property access — so rendering against a `Proxy` makes sprintf report which names it asked for. Per `.conventions/STYLEGUIDE-CODE.md`, this asks the thing that already parsed the template instead of re-deriving it with a weaker tool. The proxy pass's _output_ is discarded: sprintf collapses `%%` to `%` irreversibly during parse, so only the source template is re-renderable.

**The detection is passed in, never read.** `src/prompts/` must stay importable by a Worker without `nodejs_compat`, where a module-scope `process.env` read throws at import time. `assertPromptsGraph` in `vite.config.ts` would not catch that — `process` is a global, not an import — so the constraint is architectural: the CLI detects and passes `invocation`; a host that imports `@taskless/cli/prompts` passes nothing and gets the marker.

## Capabilities

### Modified Capabilities

- `cli-agent`: the sprintf variable table gains `TASKLESS_CLI`, and recipes are required to name the CLI through it rather than as a bare binary or a hardcoded `npx` string.
- `cli-knowledge-prompts`: the export gains `getInstructions`/`getRawInstructions` and the `invocation` option, and the rendering guarantee extends to the new variable.
- `cli`: launcher detection becomes a specified behavior — argv-shaped, pure, and allowed to answer "unknown".

## Impact

- **Modified**: `packages/cli/src/prompts/recipes.ts` (variable table, raw/rendered split, variable collection), `packages/cli/src/prompts/index.ts` (two new exports), `packages/cli/src/util/package-manager.ts` (rewritten around argv detection), `packages/cli/src/commands/agent.ts` (passes the detected invocation), all 21 files under `packages/cli/src/agent/`, `skills/taskless/SKILL.md`, `commands/tskl/tskl.md`.
- **Tests**: `test/package-manager.test.ts` is rewritten — its premise (user agent is sufficient) is what this change refutes. `test/recipe-cross-references.test.ts` moves from scanning recipe _source_ to scanning _rendered_ recipes, because a `%(TASKLESS_CLI)s agent <topic>` citation is invisible to a regex anchored on a package name. New: raw/rendered round-trip per topic, `%%` preservation, table-driven detection, prod-build-renders-a-marker, and a guard that no bare `` `taskless <cmd>` `` returns to the recipe sources.
- **Unchanged**: `getPrompt`, `PROMPTS`, `TOPICS`, `INTERNAL_TOPICS`, and every existing `PromptOptions` field. `getRecipe` keeps its `undefined`-on-unknown contract.
- **Out of scope**: detecting yarn and bun launchers; changing `PACKAGE_MANAGER_DLX`, which answers a different question (what the _consuming repo's_ CI should type) and stays a marker.

**Delivery shape: stacked, merging DOWN, in five PRs.** The units are only correct together. A recipe carrying `%(TASKLESS_CLI)s` without the renderer fails `test/prompts.test.ts`'s unresolved-placeholder assertion, and the renderer alone ships a variable no recipe uses while `test/recipe-cross-references.test.ts` still scans source for a spelling that is being removed. There is no ordering in which an intermediate `main` is both green and coherent, so the stack merges down from the tip and reaches `main` as one merge.

**Tracking:** taskless/cli#141
