## Context

`agent ok` is a built-in branch in `packages/cli/src/commands/agent.ts` that prints one sentence. Everything needed to judge staleness already exists, except a registry lookup:

- `checkStaleness(cwd)` (`install/install.ts`) compares each installed skill's version with the embedded one. `info` reports it.
- `reconcileStatus(cwd, manifest.rules)` and `getReconcileNotice(status, invocation)` (`rules/reconcile-status.ts`) decide whether `update` is due, and word it.
- `buildLauncherPackage()` (`install/launcher.ts`) names the package this build is (`@taskless/cli`, `@taskless/cli-nightly`), or returns `undefined` on a `self` build.
- `compareSemver` (`util/version-compare.ts`) orders nightlies correctly.
- Nightlies publish to `@taskless/cli-nightly` under `latest`, so both channels ask the same question of their own package.
- `isCiEnvironment(process.env.CI)` (`util/interactive.ts`) is the CI test `check` already uses.

Recipes already have a pattern for state measured at fetch time: `HOST_TOOLS` and `LEGACY_LINTERS` are whole passages chosen from options the CLI fills in (`hostTools`, `linters`). `agent.ts` asks the template's `variables` whether a measurement is needed, so no topic name is hard-coded. The prompts module must not read `process` or do I/O, because Workers import it.

## Goals / Non-Goals

**Goals:**

- `ok` is an ordinary recipe whose body is one caller-measured passage.
- One freshness module answers "what is out of date" for both `agent ok` and `check`, so the two cannot disagree.
- Neither command gets slower than the timeout, fails because of the lookup, or writes anything for it.

**Non-Goals:**

- Caching the registry answer across runs.
- Running any fix from the CLI.
- A freshness notice on commands other than `ok` and `check`.

## Decisions

**A new `ENVIRONMENT_STATUS` variable, following `HOST_TOOLS`.** `RecipeOptions` gains `environment?: EnvironmentReport`, and an exported `ENVIRONMENT_VARIABLES` set contains the variable's name. The renderer picks one of three passages: up to date, out of date with numbered steps, or (with `environment` undefined) not checked. The prompts module only formats the report, and `agent.ts` does the measuring, exactly as with `detectHostTools`. Alternative considered: keeping `ok` built in and printing the passages from `agent.ts`. That loses the header, the one-command paragraph, and the prompts export for free, which is what "ok is a recipe" asks for.

**`ok` skips the fetch-time directive.** That directive tells the agent to refetch the topic for every task, which contradicts a once-per-session preflight. The `agent` command passes `directive: false` for this one topic. The skip is keyed on the topic name, as the survey gate's topic set is.

**The latest version comes from the npm registry alone, and is validated as strict semver.** `GET https://registry.npmjs.org/-/package/<pkg>/dist-tags` returns a few dozen bytes and measured ~0.15–0.2s from a developer machine, uncached at the edge and therefore always fresh. The request uses the global `fetch` with `AbortSignal.timeout(1000)`. The answer is accepted only when `latest` matches the strict semver grammar (`MAJOR.MINOR.PATCH`, optional `-prerelease` and `+build`, nothing else), because the version is spliced into a command the user is told to run. Any throw, non-2xx response, missing `latest`, or string that fails validation means "unknown". The host is fixed. A mirror that blocks the public registry times out, silently.

Alternatives considered: racing jsDelivr's `@latest/package.json` against the registry. It is ~35ms when warm, but 0.8–1.0s cold and up to 12 hours stale, and it adds a second party, outside npm, to the path of a string the user executes. npm is already the party we trust for the install itself, so it stays the only one. `npm view` was also rejected, because it is slower, needs npm on `PATH`, and is a subprocess that sandboxes block.

**The freshness module is pure apart from its injected reads.** `measureEnvironment({ cwd, fetch, ci })` returns `{ parts: Array<"cli" | "skill" | "rules">, cli?: { running, latest, package }, skill?: {...}, rules?: ReconcileStatus }`, and runs the three checks in parallel. Step wording lives in the prompts module (for the recipe) and in one short notice formatter (for `check`). Both take the same report and the same invocation, and the rules sentence reuses `getReconcileNotice`.

**The fix for the cli part pins the exact version.** It is the detected launcher plus `<package>@<latest>` with no arguments. When the launcher is unknown, the command is rendered with the same agent-fill marker every recipe uses, rather than a guessed launcher.

**`check` starts the measurement in parallel with the scan, and awaits it at the end.** The scan usually takes longer than the timeout, so a local `check` (and a pre-commit hook) gains no latency in the common case, and at most 1s in the worst. The notice joins the existing notice list, so text and `--json` handling come free. When `isCiEnvironment` is true, the measurement is never started.

**The user runs the steps, and the agent re-checks with `agent ok`.** A harness whose permissions block Taskless commands usually blocks a newer CLI or `update` too, so an agent that offers to run the steps runs straight into the block. The skill tells the agent to hand the steps to the user to run themselves: in Claude Code with the `!` prefix, which runs the line in the session's shell, or in another terminal. When the user says they are done, the agent runs `agent ok` again to confirm. That rerun is the one exception to once per session. It is distinct from the blocked-preflight guidance, which does not offer `!`, because there `!` would clear only the one preflight call and leave every later Taskless command blocked. Here the steps are one-off commands, and running them once is the whole job.

**`NO_UPDATE_NOTIFIER` turns the lookup off.** It is the convention update-notifier and many CLIs honor, so a user who has opted out elsewhere is opted out here too. It is also how the test suite stays off the network: the suite runs as a release build with `CI` empty (so it can test local behavior), which would otherwise send every spawned `check` and `agent ok` to the registry. `vite.config.ts` sets it for every test, and the lookup's own tests clear it and stub `fetch`. This was found during implementation.

**In `check`, `NO_UPDATE_NOTIFIER` silences the whole notice, and the notice is one line.** Found when the full suite ran. Fixture projects carry stale local state, so the skill and rules parts fired in tests that assert an exact notice list. More to the point, a user who opted out of update notices does not want a local one on every commit either. `agent ok` still reports local staleness under the opt-out, because the user ran the preflight on purpose. The notice also numbers its steps inline on one line, because `vale-orchestration.test.ts` holds `check`'s `--json` notices to one line each, and a consumer should not have to split an element.

**`--anonymous` does not gate the lookup.** It means "skip the Taskless API"; npm is not it. Gating on it would also contradict `check`'s "--anonymous is a no-op" requirement.

## Risks / Trade-offs

- [A notice on every local `check` until the user upgrades, including from git hooks] → That is the point. It is one marked line and never fails the run.
- [`ok` and local `check` now touch the network] → Bounded at 1s, silent, and skipped in CI.
- [The `ok` output changes from one line to a recipe] → The skill that reads it ships in the same package and is updated in this change. An older installed skill still sees the run succeed, which is all it checks for.
- [Tests reaching the registry] → `fetch` is injected into the freshness module, and the command tests stub the global `fetch` or set `CI`.

## Migration Plan

None. The skill and the commands ship together. Rolling back is a revert.
