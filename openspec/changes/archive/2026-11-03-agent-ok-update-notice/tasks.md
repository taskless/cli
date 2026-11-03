## 1. Freshness measurement

- [x] 1.1 Add a latest-version lookup that takes a package name and an injectable `fetch`, asks the registry's dist-tags endpoint with a 1s timeout, and returns `latest` only when it is strict semver, otherwise `undefined`. Verify with unit tests covering success, a prerelease version, a non-2xx response, a throw, the timeout, a payload with no `latest`, and rejected strings (`latest`, `1.0`, `1.0.0 && echo x`, `1.0.0\n`, a leading `v`).
- [x] 1.2 Add `measureEnvironment({ cwd, fetch, ci })`: it runs the lookup (skipped in CI, when `NO_UPDATE_NOTIFIER` is set, and when `buildLauncherPackage()` is `undefined`), `checkStaleness`, and `reconcileStatus` in parallel, and returns the out-of-date parts in cli/skill/rules order with their details, leaving out skill and rules when there is no `.taskless/`. Verify with unit tests for each part alone, all three together, nothing stale, no `.taskless/`, and CI (fetch never called).

## 2. The `ok` recipe

- [x] 2.1 Add `ENVIRONMENT_STATUS` to `prompts/recipes.ts`, with `RecipeOptions.environment`, an exported `ENVIRONMENT_VARIABLES`, and the three passages (up to date, out of date with numbered steps, not checked). Steps are spelled with the resolved invocation; the cli step pins the exact version; when cli is present, the skill step points to it and gives no command of its own; the rules step reuses `getReconcileNotice`. Verify with renderer unit tests for each passage, and that rendering with no options gives the not-checked passage.
- [x] 2.2 Add `packages/cli/src/agent/ok.md` (header, `%(ONE_COMMAND_PER_CALL)s`, `%(ENVIRONMENT_STATUS)s`). Remove the built-in `ok` branch and `PREFLIGHT_TOPIC` special-casing from `commands/agent.ts`, serving `ok` through the recipe path: measure when the template uses `ENVIRONMENT_VARIABLES`, pass `directive: false` for `ok`, and keep it listed under "Preflight" in the index. Update `test/agent-ok.test.ts` for the header, both outcomes, no directive, no `.taskless/` created, and no file under an existing `.taskless/` modified. Verify that the CLI tests and the recipe and prompts-export parity tests pass.

## 3. `check` notice

- [x] 3.1 In `commands/check.ts`, when `isCiEnvironment(process.env.CI)` is false, start `measureEnvironment` alongside the scan, await it before printing notices, and publish one out-of-date notice through the existing notice path. Verify with tests: the notice appears in text and in `--json` `notices`; the exit code and results are unchanged; nothing is measured in CI; a failed lookup changes nothing.

## 4. Skill and release

- [x] 4.1 Update the preflight section of `skills/taskless/SKILL.md`: `agent ok` returns a recipe that says whether the environment is up to date; if it is, proceed; if it is out of date, give the user the steps to run themselves (with `!` in Claude Code, or in another terminal) rather than running them, carry on with the request, and when the user says they ran them, run `agent ok` again to confirm; otherwise do not rerun the preflight once it has passed. Leave the skill version alone: it tracks the CLI package version, which the changeset moves at release (`scripts/sync-skill-versions.ts` is a no-op here). Verify that the skill tests pass and that `pnpm build` passes its skill-version assertion.
- [x] 4.2 Add a `patch` changeset for `@taskless/cli` describing the `ok` environment report and the `check` notice. Verify that `.changeset/` holds the new file.

## 5. Checks

- [x] 5.1 Run `pnpm typecheck` and `pnpm lint`, and fix anything they report.
- [x] 5.2 Run `pnpm build`, then `pnpm cli agent ok` in this repo and in an empty temporary directory, and `pnpm cli check` here, and confirm the recipe renders, both exit 0, the empty directory gains no `.taskless/`, and `check`'s exit code matches a run with `CI=1`.
