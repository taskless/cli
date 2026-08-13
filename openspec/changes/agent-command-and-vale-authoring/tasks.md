# Tasks

## 1. Rename the command

- [x] 1.1 Rename `packages/cli/src/commands/help.ts` to `agent.ts` and the exported command to `agent`. Register it in `src/index.ts`
- [x] 1.2 Remove the positional-join resolution (`positionals.join("-")`). Accept at most one positional; more than one is an error rather than a joined key. The unknown-topic message points at `taskless agent`
- [x] 1.3 Keep the telemetry event name `cli_help` or rename it deliberately — decide once and record it, since dashboards key on it. If renamed, note it in the changeset alongside the `TOPICS` break
  - **Decision: keep `cli_help`.** Renaming it in the same change that breaks the `TOPICS` export would take the dashboards dark for a reason unrelated to this change, and agent-call volume needs to stay visible under the existing event. The event name is not part of any agent-facing contract, so it can be renamed later on its own. Recorded as a comment at the capture site in `agent.ts`; nothing to add to the changeset
- [x] 1.4 Update `help-extensions.test.ts`, `help-routing-telemetry.test.ts`, `anonymous-flag.test.ts`, `onboard.test.ts`, and `cli.test.ts` to invoke `agent`
  - Also required, not listed: `help-telemetry.test.ts` (imports `createHelpCommand` directly), `prompts.test.ts` (spawns `binPath help <topic>` for the parity test), and `cli-run.test.ts` (its `resolveCommandName` case named `help`)

## 2. Rename and add the authoring topics

- [ ] 2.1 `git mv` `help/static.txt` → `help/create-sg-rule.txt`; retitle its header and rewrite its Goal to name the artifact rather than the tier
- [ ] 2.2 `git mv` `help/existing.txt` → `help/create-legacy-rule.txt`; retitle and update its header
- [ ] 2.3 Flatten the `rule-*` topics to verb-noun single tokens (`rule-create` → `create-rule`, `rule-improve` → `improve-rule`, `rule-delete` → `delete-rule`, `rule-verify` → `verify-rule`), including their `.anonymous` variants. Decide `rule-meta` and `rule` deliberately — they are not creation verbs and may keep their names
- [ ] 2.4 Author `help/create-vale-rule.txt`: the three artifacts (style file, `.vale.ini` section, `pass/`/`fail` fixtures), that the scaffold ships section-less so the first rule writes the first scope, and that a rule enabled outside a section is ignored by Vale. State the evidence that makes `vale` the right engine for a rule, since no chooser topic states it any more. Cross-reference `verify-rule`
- [ ] 2.5 Author `help/create-runtime-rule.txt` as the logged-**out** path: what a runtime rule is, where its `check.ts` lives, and why executing code requires login, reconciliation, and signing when the static tiers do not. Point at `auth` for obtaining access rather than restating it. It must not forward to another authoring recipe
- [ ] 2.5a Merge `help/remote.txt` and `help/rule-create.txt` into `help/create-remote-rule.txt` (plus the `.anonymous` variant). A content merge, not a rename: both texts have material that survives, and the result must read as one procedure rather than two concatenated
- [ ] 2.6 Rewrite `help/route.txt` to read login state early and classify into the five `create-*-rule` destinations, applying the engine reasoning inline rather than deferring to a second fetch. Offer `create-remote-rule` only where it is a genuine choice — locally expressible AND logged in. A logged-in runtime request routes straight to `create-remote-rule`; a logged-out one to `create-runtime-rule`. It must name a command the agent can run verbatim
- [ ] 2.7 Merge `help/engine-selection.txt` into `help/route.txt` and delete it. Its three engine definitions, evidence-before-answer procedure, and boundary cases move into `route`'s destination table — stated once, not copied into the destinations
- [ ] 2.7a Give every `create-*-rule` recipe the same opening orientation line: what topic this is, what it helps you write, and revisit routing if that is not what you need. Fixed shape across all five so an agent recognises it; scope only, never the comparison between engines
- [ ] 2.8 Re-home the engine-reasoning requirements that survive the merge — "Available code context outranks the phrasing of the request" and "Ambiguity resolves to an engine known to be available" now bind `route` and the destinations. Update `help-extensions.test.ts`, which asserts against the standalone topic

## 3. Sweep the cross-references

- [ ] 3.1 Replace every `taskless help ` occurrence with `taskless agent ` across `src/help/*.txt`, `src/**/*.ts`, `skills/taskless/SKILL.md`, `README.md`, and `packages/cli/README.md` (~306 occurrences, 77 files). Leave `CHANGELOG.md` alone — it is a historical record
- [ ] 3.2 Update every reference to a renamed topic (`static`, `existing`, `rule create`, …) to its new single-token name
- [ ] 3.3 Add a test asserting no shipped recipe contains the string `taskless help`, and that every topic named in a recipe's See Also resolves to an embedded file. A stale cross-reference is otherwise invisible until an agent runs it

## 4. Update the export surface

- [ ] 4.1 `TOPICS` becomes `["create-sg-rule", "create-vale-rule", "create-runtime-rule"]` and no longer exports `engine-selection`; move the renamed authoring topics through `INTERNAL_TOPICS` as their membership requires, keeping the two lists disjoint and jointly exhaustive over the recipe files
- [ ] 4.2 Update `prompts.test.ts` — the membership test compares against the files on disk, so it fails until the rename is complete in both places
- [ ] 4.3 Write the changeset as **MINOR** — pre-1.0, backwards-incompatible is MINOR — naming the removed topic names explicitly and stating that `@taskless/cli/prompts` consumers break on upgrade rather than at build time

## 5. Scaffold and diagnostics (ships together)

- [ ] 5.1 `VALE_CONFIG_CONTENT` in `0004-vale-engine.ts` drops its `[*]` section, leaving `StylesPath` and `MinAlertLevel`
- [ ] 5.2 `runVale` captures stderr on a zero-exit run and returns it as a notice on the `ok` outcome; `runValeEngine` forwards it to `DispatchResult.notices`. A notice must not touch the exit code
- [ ] 5.3 Test that a rule enabled outside a section produces a notice containing Vale's `W101` text and exits zero — this is the pairing that keeps 5.1 from reintroducing a silent disable
- [ ] 5.4 Extend the mixed-engine integration test: a scaffolded project with a rule file and no section reports nothing and does not fail; adding a section makes the same rule fire

## 6. Verify

- [ ] 6.1 `pnpm typecheck`, `pnpm lint`, `pnpm --filter @taskless/cli build`, `pnpm --filter @taskless/cli test`
- [ ] 6.2 **Rehearse the recipes against a fresh agent.** For `route` and each `create-*-rule`, hand the text to a subagent with no prior context and ask it to describe the steps it would take and the commands it would run. Check its account against what the recipe intends — a recipe that reads correctly to its author and produces the wrong plan is the failure mode prose review cannot catch. Feed the corrections back into the text
- [ ] 6.2a Run `taskless agent` with no argument, with each renamed topic, and with a removed name, confirming the index lists the new vocabulary and a removed name exits non-zero
- [ ] 6.3 `pnpm openspec validate --all --strict` (note: `cli-rules` and `cli-update-engine` fail on `main` already and are unrelated)
- [ ] 6.4 Archive the change
