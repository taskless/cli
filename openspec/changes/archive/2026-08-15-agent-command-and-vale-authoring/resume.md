# Resume notes — `agent-command-and-vale-authoring`

Handoff for picking this up after a context reset, or on another machine. Not part of
the OpenSpec artifact set; delete it when the change is archived.

## Where you are

- **PR #102** (draft), branch `openspec/agent-command-and-vale-authoring`, stacked on **#100**.
- Stack below you, all green and already reviewed: **#71 → #93 → #94 → #95 → #100**.
  The user drives the merge-down; do not merge anything without being asked.
- **Groups 1, 2, 5.1 and 5.2 are done** (`093aca1`, `b0a0ee0`). 572 tests pass, typecheck
  and lint clean. `tasks.md` is the authority — read it first and trust its checkboxes
  over this file.
- Work happens in the worktree at `worktrees/impl-102`, not the main checkout. On a fresh
  machine: `git worktree add worktrees/impl-102 openspec/agent-command-and-vale-authoring`
  then **`pnpm install` inside it** — a worktree gets its own empty `node_modules`, and
  skipping the install breaks `git commit` (lint-staged) and every `pnpm` script.

## Read these before doing anything

1. `tasks.md` — the plan, including group **2b** (the recipe test harness)
2. `design.md` — decisions D1–D10, each with its rejected alternatives. No open questions.
3. `specs/*/spec.md` — what the recipes and the scaffold must do
4. `proposal.md` — the why, and the delivery shape (single PR, stacked on #100)

## Environment traps that will cost you an hour each

- **`NODE_OPTIONS` was broken in the previous session's shell** — a `--require` preload
  pointing at a deleted temp file, so every `node`, `pnpm`, and `git commit` died with
  `MODULE_NOT_FOUND`. Every command in that session was prefixed with
  `NODE_OPTIONS="--max-old-space-size=4096"`. **On a fresh machine, check whether you
  still need this** (`echo $NODE_OPTIONS`) rather than cargo-culting it.
- **Run `pnpm --filter @taskless/cli build` before `pnpm --filter @taskless/cli test`.**
  Many suites spawn the built CLI. A stale `dist/` produces failures that read exactly
  like real regressions.
- **`commit.gpgsign` must be true locally.** An earlier restack silently stripped
  signatures from 34 commits because `git rebase` does not re-sign without it, and CI does
  not catch unsigned commits. Audit with `git log --format='%G?'` after any rebase.
- **A recipe containing a literal `%` must escape it as `%%`.** Recipes render through
  sprintf-js named args, so a bare `%s` in prose (Vale's `message:` examples are full of
  them) fails at render with "mixing positional and named placeholders is not supported".
  It is caught by rendering the topic, not by the build or by typecheck.
- **`zsh` mangles `perl -0pi -e` one-liners containing `@`.** Use `python3 - <<'PY'` for
  multi-file text surgery; two attempts were lost to quoting before switching.

## What group 2 actually produced

Topic map after the rename, so you do not have to reconstruct it from the diff:

| Before                      | After                     |
| --------------------------- | ------------------------- |
| `static.txt`                | `create-sg-rule.txt`      |
| `existing.txt`              | `create-legacy-rule.txt`  |
| `remote.txt` + `rule-create.txt` | `create-remote-rule.txt` (content merge) |
| `engine-selection.txt`      | merged into `route.txt`, deleted |
| `rule-create.anonymous.txt` | **deleted** (see below)   |
| `rule-improve*.txt`         | `improve-rule*.txt`       |
| `rule-delete.txt`           | `delete-rule.txt`         |
| `rule-verify.txt`           | `verify-rule.txt`         |
| —                           | `create-vale-rule.txt` (new) |
| —                           | `create-runtime-rule.txt` (new) |
| `rule.txt`, `rule-meta.txt` | unchanged names           |

**The one deviation from the task text**: `rule-create.anonymous.txt` was deleted rather
than renamed to `create-remote-rule.anonymous.txt`. It duplicated `static.txt` outright,
and "the local-only variant of the remote recipe" is the contradiction `route` exists to
resolve. Its unique material (upstream-schema pointer, optional fields, the per-layer
verify error table) moved into `create-sg-rule.txt`, and `rule create --anonymous` now
points at `taskless agent create-sg-rule`. Recorded in `tasks.md` 2.3.

**5.1 and 5.2 were pulled forward**, out of group order and deliberately: 2b tests
`create-vale-rule` against a scaffolded project, and the recipe's central claim is that
the scaffold ships section-less. Testing against a scaffold that still wrote `[*]` would
have exercised a recipe nobody will receive.

## Next up: finish 2b (the harness), then 5.3/5.4, then group 3

### 2b is done except its control run — read `iteration-log.md` for the evidence

Five sandboxed runs across two rounds, three extension points, twenty-five findings.
**2b.1–2b.7 are complete and 2b.6 is met**: an agent given an intent the recipe never
names now produces a working rule first try, uncorrected, for `existence`,
`substitution` and `capitalization`. `create-vale-rule` went 200 → 356 lines across two
revisions.

**Only 2b.8 remains** — run the same harness over `create-sg-rule` as a control. A failure
there means the harness is wrong rather than the recipe. The procedure is below and the
scratchpad sandboxes are machine-local, so re-create them.

**One task is checked off with a caveat you should read: 2b.4.** "`verify` passes" cannot
be satisfied — see "A real gap" below. It is the one open decision in this group. Their sandboxes are under
the scratchpad at `vale-harness/sandbox-{a,b,c}`, each a real `init` scaffold, alongside
`create-vale-rule.rendered.txt` (the dev-build render they were given). **That scratchpad
is machine-local — on another machine, re-run the harness from scratch rather than looking
for it.**

To re-run it:

1. `pnpm --filter @taskless/cli build:dev` — `TASKLESS_BUILD_TARGET=dev` bakes
   `__TASKLESS_CLI__` as an **absolute** path to `dist-dev/index.js`, so the rendered
   recipe carries a command that runs from any directory. Confirmed working: the render's
   step-5 commands come out as `node /abs/path/dist-dev/index.js check …`.
2. Scaffold a throwaway project with that binary (`init --no-interactive -d <sandbox>`),
   so the sandbox is a real scaffold and not a hand-made approximation.
3. Render the recipe to a file (`agent create-vale-rule > …rendered.txt`).
4. Hand a **fresh, non-forked** subagent only: the rendered recipe path, the sandbox path,
   and a rule intent in plain words. It must **not** have repository access — with it, it
   finds `no-simply.yml` and the mixed-engine fixture and copies them, and the loop tests
   our fixtures rather than our writing. Ask explicitly for a blunt critique of the prose;
   that is the deliverable, not the rule.
5. The three intents used, chosen to exercise different extension points (everything in
   this repo today is `existence`, so a recipe drafted from our own examples teaches token
   blocklists and nothing else): hedging phrases (`existence`), "sign in" vs "login"
   (`substitution`), and GitHub's capitalization (`capitalization`, literal-match form —
   the variant the recipe covers in one line).
6. Every failure is a defect in the prose. Fix the recipe, re-run with a fresh agent.
   Converged when an agent produces a rule that fires on `fail/` and stays quiet on
   `pass/`, first try, uncorrected. Keep the iteration log (2b.7) — it is the only part a
   reviewer can check without rerunning the loop.
7. 2b.8: run the same harness over `create-sg-rule` as a control. A failure there means
   the harness is wrong rather than the recipe.

### Facts measured this session — do not re-derive

- Vale field reference for the three taught extension points is in the recipe and came
  from `https://docs.vale.sh/llms-full.txt`. **`https://docs.vale.sh/styles` is fine (200)**
  — the earlier note that it 404s was wrong; it needs `curl -L`.
- `StylesPath = .` makes `rules/` the StyleName, so `vale/rules/no-simply.yml` is the
  check `rules.no-simply`. `StylesPath = rules` resolves nothing.
- **`BasedOnStyles =` is not required for a rule to fire, and omitting it added no noise**
  in the bundled Vale version. The recipe still tells authors to write it, on the honest
  grounds that it is explicit and matches what `verify` generates — not on the claim that
  omitting it produces spurious findings, which measurement did not support.
- A rule assignment outside any section: `W101 '<id>' isn't a core option; Vale is
  ignoring it` on **stderr**, exit 0, valid `{}` on stdout. With 5.2 this now surfaces as
  `Notice: Vale reported while running: …` and the check still exits 0. Verified end to
  end against the built CLI.

### A real gap found, not yet decided

**`verifyValeRule` / `verifyValeRules` have no CLI caller.** They are exported from
`src/rules/vale/verify.ts` and exercised only by `test/vale-verify.test.ts`;
`taskless rule verify <id>` routes to `src/rules/verify.ts`, which is ast-grep only. So
there is currently **no way for an agent to verify a Vale rule from the CLI**.

`create-vale-rule` works around this by validating with `check` over each fixture bucket,
which does work today and is what the harness exercises. But it means task **2b.4's**
"`verify` passes" cannot be satisfied as written, and it is the same class of dead end
this whole change exists to remove — a capability that exists but is unreachable.

Wiring it looks small: dispatch `rule verify <id>` by which engine owns the id
(`.taskless/vale/rules/<id>.yml` vs `.taskless/sg/rules/<id>.yml`), then call
`verifyValeRule`. **Raise this with the user before doing it** — it is scope not in
`tasks.md`, and the alternative (a follow-up issue, like #99 and #101) is defensible.

## Group 3 note, when you get there

`rule.txt` documents a table of multi-token forms (`taskless help rule create`,
`… rule meta`). After group 1 these are **actively broken**, not merely stale — they hit
the "Too many arguments" path. Lead group 3 with it.

Group 2 deliberately left the wider cross-reference sweep alone (~306 `taskless help`
occurrences across 77 files). It did update See Also blocks in the six recipes it
rewrote, so 3.1 is the remaining files plus `skills/taskless/SKILL.md`, both READMEs, and
the TS sources. Leave `CHANGELOG.md` alone.

## Decisions you should not silently revisit

All are argued in `design.md` with rejected alternatives. The two most likely to be
re-litigated by accident:

- **D1** — `route` and `engine-selection` merge; the engine criterion is stated **once**,
  in `route`'s destination table. Destinations carry a short orientation line (D9), never
  a second copy of the criterion. `test/help-extensions.test.ts` now guards both halves.
- **D4** — the section-less scaffold ships **paired** with surfacing Vale's stderr on a
  zero-exit run. Shipping the scaffold alone reintroduces the silent-disable failure the
  whole Vale stack exists to eliminate. They are one requirement, not two. Both are now in.

Also settled: pre-1.0, every backwards-incompatible change here is a **MINOR** bump —
never MAJOR. The telemetry event stays `cli_help` (agent-call volume stays visible under
the existing event).

## PR #103 is stacked above this one

`openspec/self-contained-rules` (branch still named `openspec/self-contained-vale-rules`),
based on this branch. **Spec-only and green** — proposal, design, four spec deltas, tasks.
`openspec validate self-contained-rules --strict` passes.

It unifies the rule layout across all three engines: one directory per rule at
`.taskless/rules/<engine>/<id>/` holding the rule, any config that engine needs, and its
tests in `.tests/`. Plus path-addressed `verify`/`test` replacing `rule verify <id>`, and
an `example/` project.

**Implementation is approved and not started.** Follow `self-contained-rules/tasks.md`.
One caveat that is easy to miss: task 1.5 deletes the legacy read paths, and it exists
because `.taskless/rules/` is simultaneously the new root and the old
`LEGACY_RULES_DIRECTORY`. That was found by starting the refactor, not by writing the
proposal — see design D9. The partial `engines.ts` rewrite was reverted rather than
pushed, so the PR stays spec-only; regenerating it is mechanical from D1/D2 and the
task list, and worth writing *against* D9 rather than patching D9 in afterwards.

Measured facts the implementation depends on, so nobody re-derives them:

- ast-grep `ruleDirs` **recurses**; `tests/` and `__tests__/` inside a rule directory
  hard-fail the scan; **`.tests/` is skipped**, and `sg test` still reads it via `testDir`.
- Vale resolves `<id>/<id>.yml` as check `<id>.<id>` only under a `StylesPath` naming its
  parent — nothing at all under `StylesPath = .`.
- Vale rejects unknown keys in a style (`E201`), so scope cannot live in the style file.
- A `.yml` sidecar in a style directory is loaded as a rule and fails; `.vale.ini` and
  `.tests/` in the same place are ignored.
- Migrations run before any read (`ensureTasklessDirectory`), which is why the legacy
  paths are unreachable rather than merely stale.

## Outside this PR

- **#99** — migrate subprocess handling to execa (inventory and sequencing already written up)
- **#101** — whether a whole-project Vale check should skip build output; `.taskless/` is
  already excluded as of #100
- Stale worktrees under `worktrees/`; `git worktree list` to review
- `openspec validate --all --strict` fails on `spec/cli-rules` and `spec/cli-update-engine`
  on `main` already — pre-existing, unrelated, do not chase it
