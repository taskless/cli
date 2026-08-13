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
| B | "sign in" is the verb, "login" the noun | `substitution` | **yes, first try, zero retries** |
| C | it is `GitHub`, not `Github`/`github` | ended up `substitution` | **one retry** |

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

### Run B — converged, and independently confirms A's three worst findings

The agent produced `login-as-verb.yml` using regex `swap` keys, scoped it to `[*.md]`,
wrote both buckets, and got four findings on `fail/` and zero on `pass/` first try. It
also volunteered an extra probe — appending a sentence to `pass/` to test a false positive
it suspected in the `to login` key — and re-ran the bucket. That is the behavior the
recipe wants and does not currently ask for.

Two runs, no shared context, and both independently reported **a**, **g**, and the
fetch-versus-invoke ambiguity. Those are not taste.

New findings on top of run A:

| # | Finding | Verdict |
| - | ------- | ------- |
| l | `swap` keys are **Go RE2** regexes — `(?:…)` works, lookahead and lookbehind do not. The only example is two literal strings, so the agent guessed. A wrong guess fails as a **silent non-match**, the exact failure the recipe spends a section warning about | **Real, and the most valuable finding of the round.** Generalizes A's finding (c): both `tokens` and `swap` keys are patterns presented as literals |
| m | `%s` **ordering** in a substitution message is asserted only by an example that reads correctly under either interpretation. First `%s` is the swap value, second is the matched text — confirmed only by running the tool | **Real.** Pairs with A's finding (i) on `%s` count |
| n | Overlapping `swap` keys have undefined precedence. `can login` won over `login with`; `to logout` over `logout of`. First-alternative-wins is fine, but an author enumerating alternatives cannot tell how many findings a sentence yields, or which message | **Real** |
| o | Step 1 says "eleven in total" and the table lists eight; the other three are named in the following paragraph, behind a URL. Eleven only via arithmetic across two paragraphs | **Real, trivial.** List all eleven |
| p | `check <path>` lints everything under the path against the **whole config** — it is not scoped to the rule under test. With a second rule whose glob matches, the fail bucket reports both, and the recipe gives no vocabulary for that. Step 3 hints at the real isolation mechanism and never connects it to step 5 | **Real.** "Run the rule against each bucket" overstates what the command does |
| q | `BasedOnStyles =` with an empty right-hand side: the recipe insists on it without saying whether an empty value is valid INI to Vale | Minor. Measured: valid, no warning. Worth one clause |

**One finding rejected as a harness artifact, recorded so nobody "fixes" it:** run B
objected that step 5 hardcodes an absolute path into someone's checkout
(`node /Users/…/dist-dev/index.js check …`). That is `build:dev` doing its job — it
rewrites `npx @taskless/cli` to an absolute path precisely so the harness command runs
from any directory. The shipped recipe says `npx @taskless/cli`. No change.

Run B's second half of that objection is **not** an artifact and stands: the document
uses `npx @taskless/cli <cmd>` for invocations and `taskless agent <topic>` for fetches
without ever explaining the relationship. That is finding **e**.

### Run C — the only run that failed, and it found the worst defect

The one intent that did not converge first try, and the one that earned the round. It
also declined the extension point the recipe recommended, which is why it succeeded.

**C1 — the field table was factually wrong, and it fails silently.** The table said
"`%s` interpolates the match". For `substitution` that is false. Measured directly:

```
swap: {Github: GitHub},  message: "Use GitHub not %s",  document text: "Github"
→ "Use GitHub not GitHub"      (matchedText: "Github")
```

A single `%s` interpolates the **replacement**. The correct form takes two, filling
`(replacement, match)`. The recipe's own example block had it right while the normative
table one paragraph above said the opposite — so an author who reads the table rather than
copy-pasting the example ships a nonsense message. This is the worst defect found in the
round because it **passes every check the recipe tells you to run**: the rule fires, both
fixtures behave, the exit code is right, and only a human reading the message notices.

**C2 — the extension-point table pointed at a check that cannot do the job.** The row read
"how something is capitalized (headings, **product names**)" → `capitalization`, and a
later line endorsed a literal `match` "for a product name". Measured, `match: GitHub`:

```
findings: 2
  'Working with Github should be GitHub'                  matched: 'Working with Github'
  'We host on Github and it is fine. should be GitHub'    matched: 'We host on Github and it is fine.'
```

`capitalization` applies `match` to a whole **scope** — a heading, a sentence — so it
flags entire sentences and cannot express "this word, wherever it appears". Product-name
spelling is a `substitution`. The recipe named the one use case in that row the check
cannot serve, then reinforced it two lines later. The agent only avoided the trap because
it already knew the check was scope-shaped.

**C3 — the `pass/` bucket framing under-tests.** Step 4 justified the pass bucket as "the
half that catches an over-broad pattern" but described it as prose that is *correct*.
Correct prose proves nothing; the rule was never going to fire on it. The agent had to
build a throwaway probe file — URLs, code spans, `GITHUB_TOKEN` — because the fixture
model had no place for near-misses.

**C4 — the debug ladder is one-sided.** Every rung addresses `fail/` reporting nothing.
Nothing addresses `pass/` firing, which is the over-broad case the pass bucket exists for.

**One of run C's recommendations was rejected on measurement.** It proposed warning that
`ignorecase: true` would make the key `Github` also flag the correct `GitHub`. Measured:

```
ignorecase: true, swap {Github: GitHub}, text "Wrong github and Github here. Correct GitHub here."
→ 2 findings: 'github', 'Github'      ('GitHub' NOT flagged)
```

Vale skips a match that already equals its replacement, so `ignorecase: false` is not
needed to protect the correct spelling. Writing that warning in would have taught
something false. The recipe states the measured behavior instead. Worth noting as the
round's reminder that an agent's diagnosis is a lead, not a finding.

## Round 1 outcome

Two of three converged first try; the third took one retry and produced the two findings
that mattered most. Against 2b.6 — "an intent the recipe never names, first try,
uncorrected" — the recipe **passed for `existence` and `substitution` and failed for the
product-name case**, which is the honest reading.

Sixteen findings, fifteen accepted, one rejected on measurement. Every accepted finding is
a defect in the prose, which is what 2b.6 says to treat them as.

## Revision applied

`create-vale-rule.txt` was rewritten against all three reports (200 → 286 lines). What
changed, beyond the wording items:

- **All eleven extension points** are in the table, with `capitalization` explicitly
  scoped to "a whole heading or sentence" and product names routed to `substitution`.
  The trap parenthetical and the literal-`match` endorsement are gone.
- **A `%s` table**, per extension point, with the measured substitution behavior quoted.
- **A new step 3, "tokens and swap keys are patterns, not literals"**: Go RE2, no
  lookaround, implicit word boundaries, live metacharacters, first-wins on overlap, the
  measured `ignorecase` behavior, `raw`/`nonword`, and the markdown scoping that spares
  URLs and code spans. This one step carries findings c, l, n and C1's neighbours.
- **Step 6 says to read `results[].ruleId`** and states plainly that `success` and the
  exit code answer a different question — with the note that exit 1 on `fail/` is correct
  for a `level: error` rule and exit 0 is correct for a `warning` one.
- **`check <path>` is described as not scoped to the rule under test.**
- **`MinAlertLevel` joins the debug ladder**, and the ladder gains a `pass/`-fires branch.
- **The `pass/` bucket is now specified as near-misses**, not correct prose.
- **The three names that must agree** are stated once, together, with the fact that a
  mismatch is silent.
- **Claims of CLI enforcement are removed.** "Nothing checks that you wrote all three" is
  the honest statement of today's behavior, and step 7 says a whole-project `check` will
  not report the fixtures because `.taskless/` is excluded from the walk.

## Round 2 — in flight

Re-run against the revised recipe with fresh agents and intents none of round 1 used:

| Run | Intent | Extension point | Status |
| --- | ------ | --------------- | ------ |
| D | flag "click here" / "read more" as link text | `existence` | pending |
| E | headings in sentence case, with exceptions | `capitalization` (its actual use case) | pending |

E is the one that matters: it exercises the check whose guidance was wrong in round 1, on
the use case it can actually serve.

## Planned revision (applied — kept for the record)

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
5. **Step 2 — patterns, not literals.** Both `tokens` and `swap` keys are **Go RE2**
   regexes: `(?:…)` works, lookahead and lookbehind do not, and metacharacters in a real
   phrase are live. Name `raw` and `nonword`. State whether word boundaries are applied,
   per extension point. Say that overlapping alternatives resolve first-wins. This one
   item now carries findings c, l and n, and is the round's biggest single change.
6. **Step 2 — `%s` count *and* order follow the extension point.** One for `existence`,
   two for `substitution`, and in a substitution the first is the swap value, the second
   the matched text.
6a. **Step 1 — list all eleven extension points in the table**, rather than eight plus
   three in prose behind a URL.
6b. **Step 5 — `check <path>` is not scoped to the rule under test.** It lints everything
   under the path against the whole config. Say so, rather than "run the rule against
   each bucket".
7. **Step 3 — `StylesPath` resolves relative to the config file**, and use one path root.
8. **Step 2/3 — the three names that must agree**, said once as one fact.
9. **Measure the fenced-code-block question**, then answer it in a line.

Item 3 is the one that needs a decision rather than a wording pass.
