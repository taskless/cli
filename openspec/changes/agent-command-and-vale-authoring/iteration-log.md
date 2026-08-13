# 2b iteration log — executing the authoring recipes

Task 2b.7: the record of what failed, what changed, and what finally held. The recipes are
the deliverable, and a recipe that reads well to its author while producing the wrong
artifact is exactly what reviewing the prose cannot catch — so they get executed.

Delete this file when the change is archived.

## Harness

- `pnpm --filter @taskless/cli build:dev`, so `__TASKLESS_CLI__` is an absolute path to
  `dist-dev/index.js` and the rendered recipe carries a command that runs from anywhere.
- Sandbox is a real `init --no-interactive` scaffold, not a hand-made approximation.
- Each run gets a **fresh, non-forked** subagent handed exactly three things: the rendered
  recipe, the sandbox path, and a rule intent in plain words. **No repository access** —
  with it, the agent finds `no-simply.yml` and the mixed-engine fixture and copies them,
  and the loop tests our fixtures rather than our writing.
- Intents chosen to exercise different extension points. Everything in this repo today is
  `existence`, so a recipe drafted from our own examples would teach token blocklists and
  nothing else.

## Round 1

| Run | Intent | Extension point | Converged |
| --- | ------ | --------------- | --------- |
| A | flag hedging phrases in docs | `existence` | **yes, first try, zero retries** |
| B | "sign in" is the verb, "login" the noun | `substitution` | pending |
| C | it is `GitHub`, not `Github`/`github` | `capitalization` (literal match) | pending |

### Run A — converged, and that is the problem

The agent produced `no-hedging.yml`, added a scoped `[*.md]` section with
`BasedOnStyles =` and `rules.no-hedging = YES`, wrote both fixture buckets, and got six
findings on `fail/` and zero on `pass/` on the first execution. No `W101` notice, so the
assignment landed inside the section.

That is the 2b.6 bar met for one extension point. It also means **the step-5 debug ladder
was never exercised**, and the agent's critique is mostly about the rungs that ladder is
missing. Taking a first-try pass as evidence the prose is finished would be reading the
result backwards.

Findings, triaged. Verified against the source rather than taken on the agent's word:

| # | Finding | Verdict |
| - | ------- | ------- |
| a | `--json` reports `success: true` and exit 0 on **both** buckets; only `results.length` distinguishes them. The recipe hands you `--json` and describes no field of it | **Real.** An agent checking `$?` or grepping `success` concludes a working rule failed, and starts debugging it |
| b | A whole-project `check` reports nothing from the fixtures, contradicting step 3's walk model and step 6's suggestion | **Real.** `run.ts:137` excludes `.taskless/**` from the whole-project walk (the #100 fix). Fixtures live under `.taskless/`, so they are invisible to a bare `check` — correct behavior, undocumented, and the recipe's own model mispredicts its own suggested command |
| g | Step 4 asserts the CLI rejects a nested fixture directory and requires both buckets — neither is reachable | **Real, and the worst of these.** That validation lives in `verifyValeRule`, which has **zero CLI callers**. The recipe states an invariant nothing enforces, so an author who omits `pass/` sails through step 5 and never learns |
| d | `MinAlertLevel` is absent from the debug ladder, though `MinAlertLevel = error` against a `level: warning` rule produces exactly the silent failure the ladder exists for, with every listed item checking out | **Real** |
| c | `tokens` are regexes; the recipe presents them as a word list and never mentions `raw` or `nonword`, or what happens to a phrase containing regex metacharacters | **Real.** Live for hedging phrases specifically ("maybe?") |
| i | `%s` count is a property of the extension point — one for `existence`, two for `substitution` — stated nowhere, so copying the field table into a substitution rule yields `%!s(MISSING)` | **Real, cheap to fix** |
| f | `StylesPath = .` is never said to resolve relative to the directory holding `.vale.ini`, and the recipe uses two path roots (`.taskless/vale/rules/…` vs `vale/rules/…`) without reconciling them | **Real** |
| h | Three names must agree — filename, `id`, fixture directory — and are explained as if they were one | **Real** |
| e | Step 5 gives a runnable `node … check` while step 6 and See Also give `taskless agent check`; the agent could not tell whether `agent check` is a different subcommand | **Real, and corpus-wide.** Every recipe uses the bare `taskless agent <topic>` form for a fetch and `npx @taskless/cli <cmd>` for an invocation. Obvious to us, not to a first-time reader |
| j | Fenced code blocks inside markdown: does a rule fire inside them? Undefined here, and live for a docs rule | **Real, needs measuring** before writing an answer |
| k | Step 1 sends the reader to `docs.vale.sh` with no offline fallback for the eight extension points it declines to describe | Accepted. Embedding the full Vale reference is out of scope |

Nothing in this list is a defect in the agent. Every one is a defect in the prose, which
is what 2b.6 says to treat them as.

## Planned revision (not yet applied)

Batched until B and C report, so the recipe is revised once against all three rather than
three times against one.

1. **Step 5 — say how to read the output.** `results` non-empty on `fail/`, empty on
   `pass/`; `success` and the exit code are the same in both and are not the signal.
2. **Step 5/6 — fixtures are excluded from a whole-project `check`.** Say so, and stop
   implying a bare `check` is a way to see the rule fire on its own fixtures.
3. **Step 4 — stop asserting validation nothing performs.** Either the invariants become
   reachable (wire `rule verify <id>` to dispatch by engine — see `resume.md`, needs the
   user's call) or the recipe states them as author discipline rather than as something
   the CLI enforces. Do not leave the current wording; it is false.
4. **Step 5 — add `MinAlertLevel` to the debug ladder**, above the pattern.
5. **Step 2 — `tokens` are regexes.** Name `raw` and `nonword`, and say metacharacters are
   live.
6. **Step 2 — `%s` count follows the extension point.**
7. **Step 3 — `StylesPath` resolves relative to the config file**, and use one path root.
8. **Step 2/3 — the three names that must agree**, said once as one fact.
9. **Measure the fenced-code-block question**, then answer it in a line.

Item 3 is the one that needs a decision rather than a wording pass.
