Task groups map to the four forward-merging slices in `design.md`. Each group is one PR, aimed under ~300 lines including tests, and is independently safe in production. Pause for review between groups.

## 1. Error boundary and the three populations

- [x] 1.1 Add the three population codes to the `CLIErrorCode` union in `packages/cli/src/types/errors.ts`, keeping `NO_GITHUB_REMOTE` a member
- [x] 1.2 Probe for a git working tree on the failure path in `git-remote.ts` so "not a git repository" is distinguishable from "no `origin`", without adding a spawn to the success path
- [x] 1.3 Throw the population-specific code from `getOriginUrl` and from `canonicalizeGitHubUrl`
- [x] 1.4 Reword the three failure messages as a capability boundary on remote generation, each naming the local authoring path that works
- [x] 1.5 Assert in a test that no population's code is `AUTH_REQUIRED` and that the population is readable from the code alone, never from the message
- [x] 1.6 Cover all three populations at `rule create` and `rule improve` with fixture repositories, including a non-GitHub `origin`
- [x] 1.7 Cover local authoring in all three populations: `rule create --anonymous`, `verify`, and `test` complete with no GitHub precondition error
- [x] 1.8 Add the changeset on this branch, the bottom of the stack, and extend it as later slices land
- [x] 1.9 Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm cli check`

## 2. Repository fields on info

- [x] 2.1 Add `repositoryUrl` and `ghOwner` to the `info` result and to `infoOutputSchema`
- [x] 2.2 Resolve both without failing when absent: `repositoryUrl` `null`, `ghOwner` `[unknown]`, `info` still exits 0
- [x] 2.3 Leave `taskless auth` untouched, and pin its plain-text output with a test
- [x] 2.4 Test `info --json` for: a GitHub remote, and each of the three no-remote populations
- [x] 2.5 Update the `info` recipe contract with the two fields, since agents parse this payload
- [x] 2.6 Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm cli check`

## 3. gh_owner in telemetry

- [x] 3.1 Resolve the GitHub owner from the git remote inside `getTelemetry`, reusing the existing resolution rather than re-deriving it
- [x] 3.2 Add `gh_owner` to `posthog.identify` properties and to captured event properties, falling back to the literal `[unknown]` when unresolvable
- [x] 3.3 Ensure resolution works with no token, so anonymous runs carry the property, and that a failure to resolve never surfaces to the user or fails the command
- [x] 3.4 Assert the property is present and equal to `[unknown]` in each no-remote population, never omitted, empty, or null
- [x] 3.5 Assert no owner-type inference is recorded alongside it
- [x] 3.6 Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm cli check`

## 4. Recipe guards

- [x] 4.1 Teach `route.txt` to omit remote generation when no GitHub owner is identifiable, and to state why rather than silently dropping it
- [x] 4.2 Have `route` read `ghOwner` from the `info --json` call it already makes in step 2, rather than re-deriving the remote
- [x] 4.3 Add the precondition guard to `create-remote-rule.txt` so the constraint holds when the recipe is reached directly
- [x] 4.4 Extend the `## Errors` tables of both recipes with the new codes
- [x] 4.5 Cover the recipe text with the existing recipe-content tests, both the present and absent cases
- [x] 4.6 Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm cli check`

## 5. Close out

- [x] 5.1 Confirm the changeset describes what actually landed across all four slices
- [x] 5.2 Answer the two open questions in `design.md`, or record why they stay open
- [x] 5.3 Archive the change — landing as one PR, so this PR is the tip
