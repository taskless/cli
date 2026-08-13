# Resume notes — `agent-command-and-vale-authoring`

Handoff for picking this up after a context reset. Not part of the OpenSpec artifact set;
delete it when the change is archived.

## Where you are

- **PR #102** (draft), branch `openspec/agent-command-and-vale-authoring`, stacked on **#100**.
- **Work in the worktree** at `worktrees/impl-102`, not the main checkout. The main checkout
  should be on `main`; a branch can only be checked out in one worktree at a time.
- Stack below you, all green and already reviewed: **#71 → #93 → #94 → #95 → #100**.
  The user drives the merge-down; do not merge anything without being asked.
- **Group 1 of 6 is complete** (`093aca1`). Everything else is unstarted.
  `tasks.md` is the authority — read it first, and trust its checkboxes over this file.

## Read these before doing anything

1. `tasks.md` — the plan, including group **2b** (the recipe test harness)
2. `design.md` — decisions D1–D10, each with its rejected alternatives. All open questions closed.
3. `specs/*/spec.md` — what the recipes and the scaffold must do
4. `proposal.md` — the why, and the delivery shape (single PR, stacked on #100)

## Environment traps that will cost you an hour each

- **`NODE_OPTIONS` is broken in this session's shell.** It carries a `--require` preload
  pointing at a deleted temp file, so every `node`, `pnpm`, and `git commit` (husky) call
  dies with `MODULE_NOT_FOUND`. Prefix everything:
  `NODE_OPTIONS="--max-old-space-size=4096"`. The symptom is a build that looks like it
  exits 0 through a pipe while `dist/` is never written, which then fails ~125 unrelated tests.
- **Run `pnpm --filter @taskless/cli build` before `pnpm --filter @taskless/cli test`.**
  Many suites spawn the built CLI. A stale or missing `dist/` produces failures that read
  exactly like real regressions — this already caused one false alarm on `main`.
- **`commit.gpgsign` is true locally.** Keep it. An earlier restack silently stripped
  signatures from 34 commits because `git rebase` does not re-sign without it, and CI does
  not catch unsigned commits. If you rebase, audit with `git log --format='%G?'` afterwards.
- **Do not use `git checkout <file>` to undo a probe** when the file also holds uncommitted
  work — it discards both. This bit twice in the previous session.

## Next up: group 2, and how to do it

Group 2 is the authorship — the part that needs care. The user wants to see the prose before
it is finalised, but **only after 2b has been run against it**, so they review a tested
artifact rather than a draft.

Order that works:

1. Draft `create-vale-rule.txt`. Source of truth for Vale specifics is
   `https://docs.vale.sh/llms-full.txt` (a full corpus for LLM consumption), or
   `https://docs.vale.sh/topics/<page>.md?ask=<question>`. **`https://docs.vale.sh/styles` 404s.**
   Known-good facts already measured this session:
   - Common rule fields: `extends` (required), `message` (required),
     `level` (`suggestion`|`warning`|`error`, default `suggestion`), `scope`, `link`.
   - Eleven extension points: `existence`, `substitution`, `occurrence`, `repetition`,
     `consistency`, `conditional`, `capitalization`, `metric`, `spelling`, `sequence`, `script`.
   - `StylesPath = .` makes `rules/` the StyleName, so a rule at `vale/rules/no-simply.yml`
     has the check id `rules.no-simply`. `StylesPath = rules` resolves nothing — measured.
   - A rule assignment outside any `[section]` is **silently ignored**; Vale reports
     `W101 ... is ignoring it` on **stderr** with exit 0 and a valid `{}` on stdout.
2. Model its shape on `create-sg-rule.txt` (the renamed `static.txt`). If the Vale recipe
   diverges structurally, that is a signal you invented something rather than followed the
   established pattern.
3. **Run group 2b against it** before showing the user anything. See `tasks.md` 2b.1–2b.8.
   The load-bearing constraint: the test subagent gets the recipe text, a sandbox path, and a
   rule intent — and **no repository access**. With repo access it finds the existing
   `no-simply.yml` and the mixed-engine fixture and copies them, and you are testing fixtures
   rather than prose.
4. Bring the user the recipe **plus the iteration log**.

## Group 2 landmines already identified

- **`help-extensions.test.ts` has a five-test `taskless agent engine-selection` block.**
  Task 2.7 deletes that topic, so those tests must be retired as part of the merge, not after.
- **`RECIPE_TOPICS` in `agent.ts`** still lists `route/existing/static/remote/engine-selection`.
  Both `help-extensions.test.ts` and `help-routing-telemetry.test.ts` assert against that exact
  list. Groups 2 and 4 both touch it.
- **The `remote` + `rule-create` merge (2.5a) is a content merge, not a rename.** Both texts
  have material that survives; the result must read as one procedure rather than two
  concatenated. This is the piece most worth the user's eye.
- Group 1 deliberately left recipe `.txt` files untouched. **Do not start sweeping
  cross-references during group 2** — that is 3.1, and mixing them makes both unreviewable.

## Group 3 note, when you get there

`rule.txt` documents a table of multi-token forms (`taskless help rule create`,
`... rule meta`). After group 1 these are **actively broken**, not merely stale — they hit the
new "Too many arguments" path. Lead group 3 with it.

## Decisions you should not silently revisit

All are argued in `design.md` with rejected alternatives. The two most likely to be
re-litigated by accident:

- **D1** — `route` and `engine-selection` merge; the engine criterion is stated **once**, in
  `route`'s destination table. Destinations carry a short orientation line (D9), never a second
  copy of the criterion.
- **D4** — the section-less scaffold ships **paired** with surfacing Vale's stderr on a
  zero-exit run. Shipping the scaffold alone reintroduces the silent-disable failure the whole
  Vale stack exists to eliminate. They are one requirement, not two.

Also settled: pre-1.0, every backwards-incompatible change here is a **MINOR** bump — never
MAJOR. The telemetry event stays `cli_help` (the user wants agent-call volume visible under the
existing event).

## Outside this PR

- **#99** — migrate subprocess handling to execa (inventory and sequencing already written up)
- **#101** — whether a whole-project Vale check should skip build output; `.taskless/` is
  already excluded as of #100
- Stale worktrees under `worktrees/` from earlier agents; `git worktree list` to review
- `openspec validate --all --strict` fails on `spec/cli-rules` and `spec/cli-update-engine`
  on `main` already — pre-existing, unrelated, do not chase it
