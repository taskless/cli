# Tasks

Delivery shape: **stacked, merging down**, on top of `agent-command-and-vale-authoring` (PR #102). The units are only correct together — a layout change without its migration, or a migration without the assembler, ships a project whose Vale rules silently stop running. Nothing reaches `main` until all of it does.

## 1. The rule directory and its config

- [ ] 1.1 Teach `ENGINE_LAYOUTS.vale` that a rule is a directory. Add the canonical-location helper the whole change leans on: given a rule id, its directory, its style file, and its config path
- [ ] 1.2 `hasValeRules` currently looks for flat `*.yml` directly under `vale/rules/` and would report a directory-shaped rule set as "no rules configured" — a silent skip of the whole engine. Fix it first, and add the test that would have caught it
- [ ] 1.3 Read a rule's own `.vale.ini`. Preserve matcher order verbatim: precedence is positional, so reordering silently changes scope

## 2. Assembly

- [ ] 2.1 Assemble a run config from every rule's config. Deterministic: rules ordered by id, each rule's matchers in the order it declared them, `StylesPath = rules` and `MinAlertLevel = suggestion` as the header
- [ ] 2.2 Carry each matcher's `tskl) rule = <id>` breadcrumb into the assembled file. Provenance is otherwise lost the moment matchers interleave
- [ ] 2.3 Write it where the run can read it and add it to `.taskless/.gitignore`. It is a build artifact; a committed generated file drifts and invites hand edits the next assembly discards
- [ ] 2.4 Assert the assembled artifact byte-for-byte from a known rule set, and assert stability across two runs. This is the new silent-failure surface — a bug here disables rules without saying so
- [ ] 2.5 `runVale` runs against the assembled config rather than a committed one

## 3. Migration

- [ ] 3.1 New migration: move each flat `vale/rules/<id>.yml` to `vale/rules/<id>/<id>.yml`
- [ ] 3.2 Split the committed `vale/.vale.ini` — each matcher carrying `tskl) rule = <id>` moves to that rule's own config
- [ ] 3.3 A matcher with **no** `tskl) rule` breadcrumb cannot be attributed. Leave it and report it rather than guessing an owner or dropping it: an unattributable matcher is a user's hand edit, and discarding it silently changes what their check reports
- [ ] 3.4 Delete the committed `vale/.vale.ini`; gitignore the assembled path
- [ ] 3.5 Rewrite the `StylesPath` docstring in `0004`. It currently states `StylesPath = rules` is wrong, which was true for the flat layout and is now exactly backwards — the note has to explain both layouts or it will be read as a bug

## 4. `verify` and `test`

- [ ] 4.1 Resolve a path to an engine by position under `.taskless/<engine>/rules/`, never by parsing the file. A path outside any engine's rules directory is an error naming the path
- [ ] 4.2 A directory path means every rule beneath it; report per-rule results rather than one pass/fail
- [ ] 4.3 `verify <path>`: ast-grep schema + Taskless required fields; Vale style validation + the rule's own config; runtime `check.ts` plus at least one capture rule. Fixtures are NOT required for verify to pass
- [ ] 4.4 `test <path>`: ast-grep test cases, Vale fixture buckets, runtime harness. Runs `verify` first and stops on failure — today a malformed rule reports a fixture complaint while the actual error goes unmentioned
- [ ] 4.5 Delete `rule verify` and the id-based dispatch added in `bc09897`, including `rulefileOwners` and the ambiguity error. The path form has no ambiguity case to report
- [ ] 4.6 Wire both into the rule generation loop
- [ ] 4.7 Port the tests from `rule-verify-dispatch.test.ts` onto the path-addressed commands and delete the id-addressed ones

## 5. Recipes

- [ ] 5.1 Rewrite `create-vale-rule.txt` for the layout: rule directory, its own config, no shared file. The nine worked rules keep their bodies — only where the file sits and where scope is declared changes
- [ ] 5.2 Replace the `.vale.ini` walkthrough. The current step 4 teaches editing a shared config and carries the `W101`-outside-a-matcher warning; both describe a situation that no longer exists
- [ ] 5.3 Step 6 names `verify` and `test` rather than reading `results[].ruleId` out of `check`
- [ ] 5.4 Update `verify-rule.txt` for both commands; sweep every recipe naming `rule verify`
- [ ] 5.5 Re-run the 2b harness against the rewritten recipe — fresh agents, no repository access, the same three extension points. The recipe changed materially, so its prior convergence does not carry over
- [ ] 5.6 Re-verify the nine worked rules by extracting the YAML from the *rendered* recipe and executing it, as before. What ships must be what was tested

## 6. An example project at `<root>/example`

**Primarily so a person can see what a Taskless install looks like.** The tests cover behavior thoroughly, but they build their fixtures inside the test that reads them — so nothing in the repository shows the layout as a reader would encounter it. `example/` is that: a small, real project someone can open and understand in a minute.

Its second job is to stop being wrong. A demo that drifts from the layout it demonstrates is worse than none, so a test runs `check` against it — the example rots loudly rather than quietly.

- [ ] 6.1 `example/README.md` — what this is, what each file is for, and what `check` reports against it. Written for someone who has never installed Taskless and wants to see the shape before they do
- [ ] 6.2 `example/example.html` and `example/example.cjs` — the prose and the code the rules have something to say about. Keep both small enough to read in one screen
- [ ] 6.3 `example/.taskless/` with one Vale rule and one ast-grep rule, each in its canonical location, each with its fixtures. The Vale rule exercises the new directory layout end to end
- [ ] 6.4 A test that runs `check` against `example/` and asserts on the findings. This is what keeps the demo honest: a layout change that breaks it fails the build instead of leaving a misleading example in the repo
- [ ] 6.5 A test that runs `verify example/.taskless/` and `test example/.taskless/` — the directory form, which is also the CI form
- [ ] 6.6 Add `example/` to the root tooling ignores that would otherwise walk it. `.taskless/` inside it holds rule YAML and fixture documents that are deliberately wrong prose, and a root-level prettier or eslint pass reaching them fails on content nobody wrote as source

## 7. Verify

- [ ] 7.1 `pnpm typecheck`, `pnpm lint`, `pnpm --filter @taskless/cli build`, `pnpm --filter @taskless/cli test`
- [ ] 7.2 End-to-end against a scaffolded project: author two rules with different globs, confirm each fires only in its own scope, and confirm deleting one directory leaves the other's scope untouched
- [ ] 7.3 Confirm a hand-edited assembled config has no effect on the next check — it is regenerated
- [ ] 7.4 `pnpm openspec validate --all --strict`. Note that the `cli-agent-authoring` delta modifies a requirement #102 introduces, so this only passes cleanly once #102 archives
- [ ] 7.5 Extend the changeset on the bottom of the stack with this change's breaks: the Vale rule layout, the removal of `rule verify`, and the new `verify`/`test` commands
- [ ] 7.6 Archive the change
