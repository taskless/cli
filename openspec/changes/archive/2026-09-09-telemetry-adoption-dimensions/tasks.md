# Tasks

**Delivery shape: single PR.** The dimensions are only useful together — a
`workspaceId` without `ci` produces workspace counts that CI still inflates, and
shipping them in sequence would start each cohort clock on a different date, so
the first comparable window would be the last property's. One reviewable diff,
no stack.

## 1. Resolve workspace and repository identity

- [x] 1.1 Add a workspace-root resolver: `git rev-parse --show-toplevel`, falling back to the resolved working directory when the command fails for any reason, including git being absent. Never throws — the existing `resolveRepositoryContext` is the shape to follow
- [x] 1.2 Hash the root path with SHA-256, hex-encoded, as `workspaceId`. Assert in a test that a subdirectory and the root produce the same value, since that equality is the whole reason the resolver looks upward
- [x] 1.3 Add a host-agnostic repository canonicalization beside `canonicalizeGitHubUrl`. **Do not extend the GitHub one**: it throws `UNSUPPORTED_REMOTE_HOST` deliberately, and that refusal is a capability boundary on remote rule generation that this change must not soften
- [x] 1.4 Cover the remote forms `canonicalOwnerUrl` already handles — scp-like SSH, `ssh://`, `git://`, `https://`, bare owner — at repository granularity rather than owner granularity
- [x] 1.5 Hash it as `repositoryId`; emit `[unknown]` when no remote resolves, present rather than omitted
- [x] 1.6 Test that a GitLab or self-hosted remote yields a real `repositoryId` while `ghOwner` is `[unknown]`. That combination is the point of the property and is the case a GitHub-shaped implementation silently gets wrong

## 2. Resolve the execution environment

- [x] 2.1 Add `envOS` from `process.platform`
- [x] 2.2 Add `ci`, treating unset, empty, `"0"`, and `"false"` as false and any other non-empty value as true. `init.ts` already reads `process.env.CI` for interactivity with a narrower test (`"true"`/`"1"`); leave it alone and note the difference — one decides whether to prompt, the other classifies a run, and they are allowed to disagree
- [x] 2.3 Add `ciProvider` with a provider table, `[unknown]` when `ci` is true and nothing matches, `[none]` when `ci` is false
- [x] 2.4 Test all three branches of `ciProvider`. The `[unknown]`/`[none]` distinction is the one that matters: collapsing them loses the ability to tell an unrecognized provider from a local run

## 3. Resolve the language stack

- [x] 3.1 Export `LANGUAGE_MARKERS` from `detect/scan.ts` and read the probe's mapping from it, so the two cannot disagree about which manifest means which language
- [x] 3.2 Add the Node manifest to the probe's inputs. `LANGUAGE_MARKERS` has no entry for JavaScript or TypeScript — the scan derives those from `package.json` separately — so a probe built from the constant alone reports nothing for the stack the CLI is most used on
- [x] 3.3 Probe the workspace root only, with `existsSync`, and assert in a test that `detectRepository` is not called. The scan is a recursive walk with manifest parsing, and this runs on every invocation including `agent`
- [x] 3.4 Emit an empty array, not an omitted property, when nothing matches

## 4. Attach the dimensions

- [x] 4.1 Resolve all six once in `getTelemetry` and attach them to `identify` and to every `capture`, alongside `cli`/`cliVersion`/`scaffoldVersion`/`ghOwner`
- [x] 4.2 Keep every resolution inside the existing failure-tolerant path: a dimension that cannot be resolved yields its sentinel, and telemetry that fails entirely still falls back to the no-op client
- [x] 4.3 Confirm `TASKLESS_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1` still short-circuit before any resolution runs — no git spawn, no filesystem probe, no `anonymous_id` read. The opt-out has to stay an opt-out of the work, not only of the send

## 5. Report the rule count

- [x] 5.1 Add `ruleCount` to `scanCounts` in `check.ts`, set from the rules the scan loaded
- [x] 5.2 Set it on the path that assigns `scanCounts` today, so a scan that throws after loading rules keeps reporting nothing rather than reporting a partial count

## 6. Say so in the spec

- [x] 6.1 Add the three new requirements: workspace and repository identity, execution environment dimensions, language stack dimension
- [x] 6.2 Amend the standard-properties requirement to list the six dimensions
- [x] 6.3 Amend the taxonomy requirement's `cli_check_completed` bullet to include `ruleCount`
- [x] 6.4 Carry every existing scenario into both MODIFIED deltas — 4 in standard-properties, 5 in the taxonomy requirement — and keep both TITLES byte-identical, including the escaped underscore in `CLI events use cli\_ prefix`. A delta replaces a requirement rather than patching it, and a renamed title applies nothing at all
- [x] 6.5 Verify by archiving on a scratch commit and grepping the standing spec for every prior scenario, then resetting to the recorded SHA

## 7. Close out

- [x] 7.1 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`
- [x] 7.2 Add a changeset. Pre-1.0, added telemetry surface is a `patch`: no consumer must react to it
- [x] 7.3 Archive the change
