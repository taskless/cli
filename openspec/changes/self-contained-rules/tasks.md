# Tasks

Delivery shape: **stacked, merging down**, on top of `agent-command-and-vale-authoring` (PR #102). The units are only correct together — a layout change without its migration, or a migration without the assemblers, ships a project whose rules silently stop running. Nothing reaches `main` until all of it does.

`0005` layers on `0004`. Both are unreleased and both ship in this stack, so every consumer runs them as one upgrade and never observes the intermediate layout.

## 1. The layout

- [x] 1.1 `ENGINE_LAYOUTS` becomes one rule-directory rule (`rules/<engine>/<id>/`) plus per-engine contents. Every path helper derives from it; no caller reconstructs a path by hand
- [x] 1.2 Pin the dot-directory assumption with a test: a rule directory containing `.tests/` with test YAML in it, asserting `sg scan` completes clean. This is the load-bearing undocumented behavior (design D2) and it must be checked on every run rather than remembered
- [x] 1.3 `hasValeRules` looks for flat `*.yml` under `vale/rules/` and would read a directory-shaped rule set as "no rules configured" — a silent skip of the whole engine. Fix it and add the test that would have caught it
- [x] 1.4 Runtime discovery reads capture rules from `captures/`; `check.ts` stays at the rule root
- [x] 1.5 **Delete `LEGACY_RULES_DIRECTORY` and `LEGACY_RULE_TESTS_DIRECTORY` and their readers** in `rules/verify.ts`, `detect/scan.ts`, and `commands/rules.ts`, including the error messages that name the legacy path as somewhere a rule might live. `.taskless/rules/` is now the new root and the legacy constant is the same string — a stale read path that resolves into the live tree is worse than none. Migrations run before any read (`ensureTasklessDirectory`), so the state they guard against cannot exist (design D9)

## 2. Assembly

- [x] 2.1 Assemble the Vale run config from every rule's `.vale.ini`. Deterministic: rules ordered by id, each rule's matchers verbatim in its own order, `StylesPath` and `MinAlertLevel` as the header
- [x] 2.2 Carry each matcher's `tskl) rule = <id>` breadcrumb through assembly. Provenance is otherwise lost the moment matchers interleave
- [x] 2.3 Assemble `sgconfig.yml`: `ruleDirs` over the rules tree, one `testConfigs` entry per rule's `.tests/`
- [x] 2.4 Gitignore both assembled configs. They are build artifacts; a committed generated file drifts and invites hand edits the next assembly discards
- [x] 2.5 Assert both assembled artifacts byte-for-byte from a known rule set, and assert stability across two runs. This is the new silent-failure surface — a bug here disables rules without saying so
- [x] 2.6 `runVale` and the ast-grep scan run against the assembled configs

## 3. Migration `0005`

- [x] 3.0 Assert `.taskless/rules/` holds no top-level `*.yml` before writing engine directories into it. `0004` empties it by moving it to `sg/rules/`, so a file still there means `0004` did not complete, and proceeding would interleave two layouts in one tree
- [x] 3.1 Move `<engine>/rules/<id>.yml` → `rules/<engine>/<id>/<id>.yml`; runtime `runtime/rules/<id>/` → `rules/runtime/<id>/`, its `*.yml` into `captures/`
- [x] 3.2 Move `<engine>/rule-tests/<id>*` → `rules/<engine>/<id>/.tests/`, preserving each engine's internal test shape
- [x] 3.3 Split the committed `vale/.vale.ini` — each matcher carrying `tskl) rule = <id>` into that rule's own config
- [x] 3.4 A matcher with **no** `tskl) rule` breadcrumb cannot be attributed. Leave it and report it rather than guessing an owner or dropping it: an unattributable matcher is a user's hand edit, and discarding it silently changes what their check reports
- [x] 3.5 Delete the committed `vale/.vale.ini` and `sg/sgconfig.yml`
- [x] 3.6 Preserve content byte-for-byte. Runtime capture bytes determine server-side reconciliation hashes, so a rewrite invalidates every signature
- [x] 3.7 Rewrite the `StylesPath` docstring in `0004`. It states `StylesPath = rules` is wrong — true for the flat layout, exactly backwards now. It has to explain both or a future reader will "fix" it back
- [x] 3.8 Idempotent, and a no-op on an already-migrated tree

## 4. `verify` and `test`

- [x] 4.1 Resolve a path to an engine from its `<engine>` segment, never by parsing the file. A path outside the rules tree is an error naming the path
- [x] 4.2 A directory above a rule means every rule beneath it; report per-rule results rather than one pass/fail
- [x] 4.3 `verify <path>`: ast-grep schema + Taskless required fields; Vale style validation + the rule's `.vale.ini`; runtime `check.ts` plus at least one capture. Tests are NOT required for verify to pass
- [x] 4.4 `test <path>`: ast-grep test cases, Vale `.tests/` buckets, runtime harness. Runs `verify` first and stops on failure — today a malformed rule reports a fixture complaint while the real error goes unmentioned
- [x] 4.5 Delete `rule verify` and the id-based dispatch added in `bc09897`, including `rulefileOwners` and its ambiguity error. The path form has no ambiguity case
- [x] 4.6 Wire both into the rule generation loop
- [x] 4.7 Port `rule-verify-dispatch.test.ts` onto the path-addressed commands; delete the id-addressed tests

## 5. Recipes

- [x] 5.1 Rewrite `create-vale-rule.txt` for the layout: rule directory, its own config, `.tests/`, no shared file. The nine worked rules keep their bodies — only where the file sits and where scope is declared changes
- [x] 5.2 Replace the `.vale.ini` walkthrough. The current step teaches editing a shared config and carries the `W101`-outside-a-matcher warning; both describe a situation that no longer exists
- [x] 5.3 Step 6 names `verify` and `test` rather than reading `results[].ruleId` out of `check`
- [x] 5.4 Update `create-sg-rule.txt` for the rule-directory layout, `verify-rule.txt` for both commands, and sweep every recipe naming `rule verify`
- [x] 5.5 Re-run the 2b harness against the rewritten recipes — fresh agents, no repository access, the same three extension points. The recipes changed materially, so prior convergence does not carry over
- [x] 5.6 Re-verify the nine worked rules by extracting the YAML from the *rendered* recipe and executing it. What ships must be what was tested

## 6. An example project at `<root>/example`

**Primarily so a person can see what a Taskless install looks like.** The tests cover behavior thoroughly, but they build their fixtures inside the test that reads them — so nothing in the repository shows the layout as a reader would encounter it. `example/` is that: a small, real project someone can open and understand in a minute.

Its second job is to stop being wrong. A demo that drifts from the layout it demonstrates is worse than none, so a test runs `check` against it — the example rots loudly rather than quietly. It also counteracts `.tests/` being dot-hidden, by showing a complete rule directory somewhere nothing is hidden.

- [x] 6.1 `example/README.md` — what this is, what each file is for, and what `check` reports against it. Written for someone who has never installed Taskless and wants to see the shape before they do
- [x] 6.2 `example/example.html` and `example/example.cjs` — the prose and the code the rules have something to say about. Small enough to read in one screen
- [x] 6.3 `example/.taskless/` with one Vale rule and one ast-grep rule, each in its canonical directory with its `.tests/`
- [x] 6.4 A test that runs `check` against `example/` and asserts on the findings. This is what keeps the demo honest: a layout change that breaks it fails the build instead of leaving a misleading example in the repo
- [x] 6.5 A test that runs `verify example/.taskless/rules/` and `test example/.taskless/rules/` — the directory form, which is also the CI form
- [x] 6.6 Add `example/` to the root tooling ignores that would otherwise walk it. Its `.tests/` hold deliberately wrong prose, and a root prettier or eslint pass reaching them fails on content nobody wrote as source

## 7. Verify

- [x] 7.1 `pnpm typecheck`, `pnpm lint`, `pnpm --filter @taskless/cli build`, `pnpm --filter @taskless/cli test`
- [x] 7.2 End-to-end: author two Vale rules with different globs, confirm each fires only in its own scope, and confirm deleting one directory leaves the other's scope untouched
- [x] 7.3 Confirm a hand-edited assembled config has no effect on the next check — it is regenerated
- [x] 7.4 Migrate a `0004`-shaped fixture through `0005` and confirm the rules still fire, the tests still run, and runtime signatures are unchanged
- [x] 7.5 `pnpm openspec validate --all --strict`. The `cli-agent-authoring` delta modifies a requirement #102 introduces, so this passes cleanly only once #102 archives
- [x] 7.6 Extend the changeset on the bottom of the stack: the rule layout, the removal of `rule verify`, the new `verify`/`test` commands
- [ ] 7.7 Archive the change

**7.7 is blocked on #102, and cannot be unblocked from here.** A change archives once, on whichever PR is the tip, and the gate requires `openspec/changes/` to hold no unarchived directory at all. `agent-command-and-vale-authoring` still has 14 open tasks (groups 3, 4, 5, 6 — the `taskless help` → `taskless agent` cross-reference sweep, the `TOPICS` export surface, and its own verification), so its directory has to stay. Archiving it early would delete the spec deltas for work that has not been done.

The ordering is also one-way for a second reason already noted in 7.5: this change's `cli-agent-authoring` delta modifies a requirement #102 introduces, so #102 has to archive first for that delta to have a target.

So: finish #102's groups 3–6, archive `agent-command-and-vale-authoring`, then archive this change. Both archives land on the tip PR.

Note on 7.5: `cli-rules` and `cli-update-engine` fail `--strict` on `main` already and are unrelated to this stack (confirmed by diffing both specs against `origin/main` — this stack never touched them). `change/self-contained-rules` itself validates clean.
