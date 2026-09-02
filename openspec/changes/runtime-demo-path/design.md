## Context

The runtime tier has three parts, and only two of them can be tested from one
repository. Discovery, signing, validation and writing are ours. Generation is
the service's. The handshake between them — a signature the service blessed
over bytes this client then wrote — belongs to neither and is tested by
neither.

The payload alignment work made that concrete. Every defect it surfaced lived
in the seam and was found by a person noticing: a runtime rule below the
file-set floor admitted rather than withheld, a signature attached to the wrong
rule, a capture dropped for want of a name, a rule written and never executed.
An empty scan reports success, so the symptom was almost always "no findings"
rather than an error.

`check` is the wrong place to close that gap. It reports on a user's project,
and the whole of the last change was about it not doing anything else.

## Goals / Non-Goals

**Goals:**

- One deliberately-invoked command that walks generation, delivery, writing and
  verification, and says what happened at each step.
- Run on the paths a user runs on, so what it proves is what users get.
- Work with no login, so it can be shown to someone who does not have an
  account yet.
- Leave the project recoverable: whatever it writes can be removed.

**Non-Goals:**

- Not a correctness test of the generated rule. The rule may be poor; that is
  acceptable and `rule delete` removes it.
- Not a replacement for reconcile, and not a second way to get rules.
- Not reachable by routing. An agent deciding how to author a rule must never
  land here.
- Not a demonstration of execution. See D3.

## Decisions

### D1 — The demo uses the well-known ticket and retrieval formats

`POST /cli/api/demo/request` returning `{ requestId, status }`, then
`GET /cli/api/demo/request/{requestId}` returning `{ requestId, status, rules[] }`. The
same two-stage flow as `rule create`, the same status enum, the same file-set
variant.

The alternative — one endpoint returning a rule directly — is smaller and
wrong. A demo exists to show the real path, so a payload shape that only the
demo uses would demonstrate something no user is on. Mirroring also means the
demo covers polling and the terminal `failed` and `unsupported` states for
free, because it is the same client code reaching them.

Concretely, and the three are not equal — saying "reuse" without splitting them
would make the failure test below fire for a reason it was not built to catch.

**`writeRuleFile` is reused byte for byte, and it is what the test is about.**
It carries the path checks, the completeness rules, the layout validation and
the refusal to write a runtime rule with no captures. **If the demo needs a
different writer, the payload shapes have diverged**, and the demo has done its
job by failing. That is the signal worth having, and it is the whole reason for
mirroring the delivery variant.

**`submitRule` and `pollRuleStatus` need work first, and that is a task rather
than a divergence signal.** Both hardcode their endpoint as a literal, and both
take a required `token`, which `createApiClient` turns unconditionally into an
`Authorization: Bearer` header. The demo is unauthenticated by requirement (D3),
so neither is usable as it stands: the endpoint has to be a parameter, and the
token has to be optional.

**An earlier draft said the path half "resolves itself when the client adopts
the renamed family". It did not, and the correction is worth keeping.** The
client has since adopted it — those two functions now call `/cli/api/request`
and `/cli/api/request/{requestId}` — and they are no less hardcoded for it. The
demo's endpoint is `/cli/api/demo/request` either way, so what stood between the
demo and reuse was never which noun the literal spelled; it was that the literal
is not a parameter. Both halves are ours, and both are planned in task 1.2a
rather than discovered during implementation.

Neither is evidence of anything having gone wrong. They are two small changes to
functions written when every caller was authenticated and every caller wanted
the same route.

The distinction matters because D1's failure test is a **claim about payload
shapes**. A requester that needs a second argument says nothing about whether
the demo and the mainline agree on what a rule looks like.

### D2 — The demo tracks the mainline's naming, and follows rather than leads

The paths above mirror the mainline's naming, whatever it currently is. The
demo must never be where a second convention lives. Its value is being
indistinguishable from the path users take; a demo that is tidier than
production is a demo that stops proving anything. If the mainline is renamed
again, these are renamed with it.

**That principle already cost this change a wait, which is the evidence it is
real.** The generator team renamed the request resource from `rule`/`ruleId` to
`request`/`requestId` as its own change (**N10**, the inconsistency being that
`ruleId` named a ticket, by the service's own field description). That rename
has landed and is verified live, so the demo takes the settled noun above.
Naming the demo endpoints before it landed would have made the demo the debut
of the new convention, which is precisely what this decision forbids.

Adopting the new noun in the _ordinary_ client was a separate change and was
never this one's dependency. `/cli/api/rule/*` still serves, marked
`deprecated`, so the mainline client was not broken by having not moved yet, and
the demo, being new, had no reason to be born on the deprecated spelling. That
separate change has since landed as well, so the two agree; the Risks section
records what the move taught.

### D2a — The fixed input is data the service holds, not a repository

An earlier draft of this proposal said "a public repository the service
controls". That was wrong, and the generator team corrected it: CLI-bound
generation never clones. The clone is deferred to the git-bound push, which
happens only for a pull request, and `repositoryUrl` on a CLI request is
authorization scoping and a ticket field rather than model input.

So the fixture is a prompt and its examples, held as data alongside the
rule-hash vectors. Naming a repository would have been decoration, and
decoration is what a later reader tries to make load-bearing.

### D3 — It stops at `verify`, and that is stated rather than worked around

A runtime rule executes only when an authenticated reconcile returns its
signature in `run`. The demo is unauthenticated, so it cannot reach execution:
`check` skips the rule and reports "not authenticated — runtime rules were not
verified and did not run."

Three options existed. Stopping at `verify` is honest and shows generation,
delivery, the file set, and validation. `--dangerously-run-scripts` reaches
execution and prints the warning it always prints, which is truthful and
conspicuously not the signature story. A client-side bypass keyed on the demo
rule id would show the real thing and is refused.

That third option is the one worth writing down, because it is the tempting
one. The signature gate is the only thing between a payload downloaded over the
network and arbitrary code running on a developer's machine. A hole in it that
exists "only for the demo" is a hole, and the id it keys on is attacker-visible
in the recipe. No demo is worth that.

The consequence is that this change demonstrates everything up to the gate.

**An earlier draft of this section said logging in was "the next beat". That is
wrong, and the correction matters more than the wording.** Blessing is
recording: a signature exists for a rule because that rule was written into an
organization's corpus. The demo rule is one fixed rule, served to every caller
from a Taskless-owned installation, and it is never recorded for the caller. So
there is no signature for it in any caller's `run` set, and authenticating adds
nothing — the gate is not a step the demo stops just short of, it is unreachable
by construction from a shared fixture.

That also disposes of the idea that the demo half-serves the blessed-execution
handshake and should be extended to serve it fully. It cannot. Exercising "we
bless, you run" needs a rule recorded for the organization that runs it, which
is what an ordinary authored rule already is. If that seam wants automated
coverage, the honest shape is an integration test against an organization we
own — not a demo — and it should be argued on those terms rather than folded in
here. Until someone does, the seam is covered by unit tests on each side and by
nothing that spans them, and this change records that rather than obscuring it.

### D4 — Hidden by omission, not by a new mechanism

`RECIPE_TOPICS` in `commands/agent.ts` is a hand-maintained literal; `getRecipe`
looks up by filename. A recipe file that is not in the list is therefore
fetchable by name and absent from the index already.

Adding a hiding mechanism — a naming convention the loader understands, a
metadata field — would be new code to serve a property the existing design
already has. The `__` prefix in the topic name is for human readers, not for
the loader.

The cost is that the index is curated by hand and can drift from the files on
disk. That is already true, and `cli-agent` gains a requirement saying it is
intended rather than an oversight.

### D4a — The demo command nests under `rule`, so the second listing never sees it

`taskless agent` prints **two** lists, and omission from `RECIPE_TOPICS` only
governs one of them. The first, headed `Topics:`, is built by iterating
`Object.entries(subCommands)` — the top-level command tree from `src/index.ts`,
gated by `SUBCOMMAND_NAMES` in `commands/names.ts` — and it filters exactly one
name, `agent` itself. Nothing in it consults `RECIPE_TOPICS`. The second,
headed `Authoring recipes:`, is `RECIPE_TOPICS`, and that is the list D4 is
about.

So a demo registered as a new top-level verb would be hidden as a recipe and
advertised as a command in the same output, which is the opposite of the
property this change wants. **The demo command is therefore `rule demo`, a
subcommand of the existing `rule` command**, alongside `create`, `improve`,
`meta` and `delete`. It writes a rule, so it reads correctly there, and it adds
no entry to `SUBCOMMAND_NAMES` or `subCommands` — meaning the `Topics:` listing
is untouched and no filtering code has to be written to keep it that way.

This is the same reasoning as D4 rather than an exception to it: the property is
obtained by not registering the thing, not by teaching a renderer to skip it.
The consequence is that `taskless rule --help` does list `demo`, from citty's
own usage output. That is intended. The requirement is that **routing** never
sends an agent to the demo, not that the demo is a secret — a person reading
`rule --help` has already chosen to look, and D3's risks say the same about the
recipe.

### D5 — Failure is reported, never fabricated

If generation cannot be served, the service answers with a terminal status and
a reason, and the demo prints it. The client already prefers the service's
reason over its own text for `unsupported`, so this needs nothing new.

A demo that invents a rule when generation fails would be worse than a demo
that fails, because it would look like success.

### D6 — The findings ship as `Finding[]`, grouped by the example that produced them

**This shape is under revision and is not yet agreed with the service.** Task
0.4 — telling the service what findings shape we want — is open, so what follows
is the ask rather than the contract. The retrieval shape the two sides have
settled is D1's, and it does not include this.

The service offered either its harness's `Finding[]` or something narrower, and
left the shape to us since we render it.

`Finding[]` as-is, because it is not the service's internal type: `Finding` is
declared in `types/runtime-rule.ts` as part of the runtime-rule contract, and is
what a check returns on this side. Choosing a narrower demo-only object would be
introducing a payload only the demo consumes, which is the thing D1 exists to
forbid. The same reasoning that reuses `submitRule`, `pollRuleStatus` and
`writeRuleFile` applies to the type a check's results already have.

What the demo does add is a wrapper, and the wrapper is the part carrying the
demonstration:

```
examples: [ { name, expectation: "fails" | "passes", findings: Finding[] } ]
```

A flat list of findings cannot distinguish a rule that catches the failing
examples from one that fires on everything it is shown, and those two render
identically as "3 findings". The second is the recurring defect in this area
wearing a success costume — an empty or indiscriminate scan reporting as a pass.
Attributing each finding to an example, and stating what that example was
expected to do, makes the asymmetry the thing a reader sees: findings on the
examples that should fail, none on the examples that should pass.

That also makes the demo checkable rather than merely viewable. The CLI can
assert the asymmetry instead of printing whatever arrives, so a demo that
silently stops finding anything fails rather than looking clean.

### D7 — Each thing the demo cannot do is the behaviour we want, not a shortfall

D3 and D6 describe the demo negatively: it cannot reach the gate, and it must
fail rather than render an indiscriminate rule. Read together they invite the
wrong conclusion, that the demo is a reduced version of something better. It is
not. Every limit is a correct behaviour arriving through the ordinary path.

**The rule is real and inspectable.** A developer gets `check.ts` and its
captures on disk and can read what a runtime rule actually is. That is the
demonstration. Note what is _not_ on disk: a signature. `run-set.ts` computes
one from the check's bytes at reconcile time; delivery never writes a signature
artifact. So there is nothing to inspect there and nothing to tamper with, and
the demo's value is the rule's content rather than a token.

**It is inert, and inert is the correct state.** An ordinary `check` skips it
because no signature for it is in any organization's `run` set. A developer who
runs `check` and sees the rule skipped is watching the gate work, on the
ordinary code path, with the reason `check` already prints. Nothing about the
demo is special-cased to produce that.

**It is removable, through the delete flow we already own.** No demo-specific
teardown, no residue `verify` or `check` reports afterwards.

**`improve` does not work on it, and should not.** Improvement resolves a
request the caller's organization holds. The demo request is held by a
Taskless-owned installation and by no caller's organization, so improvement is
refused and nothing is written. That behaviour is the part this design rests on.

**Which status the service returns for it is not settled, and this design no
longer asserts one.** An earlier draft said `RULE_NOT_FOUND`. That is a claim
about the service rather than about us, and the client's own handling makes it
consequential: `iterateRule` turns a 404 `request_not_found` into a `CLIError`
carrying `RULE_NOT_FOUND`, and turns a 403 `access_denied` into a plain `Error`,
which `improveCommand` reports as `NETWORK_ERROR`. A request that genuinely
exists and merely is not yours is 403-shaped rather than 404-shaped. If that is
what the service sends, `improve` on the demo rule reports `NETWORK_ERROR` and
tells an agent to retry an id that will never resolve — the exact
miscategorisation `iterateRule`'s own comment was written to prevent. Asserting
`NETWORK_ERROR` instead would trade one unconfirmed claim for another, so task
0.5 asks the service which status a ticket outside the caller's organization
returns, and the requirement states the behaviour until that answer exists.

The deeper reason for refusing is worth stating separately, because it holds
whatever the status turns out to be: a pre-generated rule built against a shared
fixture is a bad base to iterate on.
Nothing generated in advance can match a rule authored against this developer's
own repository and context, so offering the demo rule as a starting point would
be offering a worse starting point wearing the demo's credibility.

**This is correct-by-accident until it is pinned.** Each of these follows from
existing behaviour rather than from code written for the demo, which is exactly
the situation the `metadata.taskless` test was written for: behaviour we depend
on, produced by code that never knew about us. Tasks 3.4 and 5.2 pin the two
that would be silent if they broke.

## Risks / Trade-offs

**The demo was born on `request`/`requestId` ahead of the ordinary client, and
that skew has since closed.** It was deliberate (D2) and bounded while it
lasted: the `rule/*` family still serves, marked `deprecated`, so nothing was
broken by the mainline not having moved yet. The mainline has now moved.
`submitRule` posts to `/cli/api/request`, `pollRuleStatus` gets
`/cli/api/request/{requestId}`, `iterateRule` and `restoreRule` follow, and no
hand-written call site targets the `rule/*` family.

**How that move landed is the part worth keeping, because this section's
expectation was wrong.** It assumed regenerating the types would catch the
typed call sites at compile time, leaving only the two that build their URL as a
template string to change by hand. It caught none of them. A deprecated path is
still IN the OpenAPI document, so `openapi-typescript` emits it as an ordinary
entry and `client.GET("/cli/api/rule/{ruleId}")` type-checks exactly as well as
the canonical spelling; all four typed call sites were reverted and `tsc
--noEmit` passed clean. What closes that gap is a test rather than the type
system: `generate:api` vendors the OpenAPI document next to the types it
generates, and `test/api-deprecated-paths.test.ts` reads that document to fail
if any source file still calls a path it marks deprecated. Deprecation is data
in the schema, not a type error, so catching it takes something that reads the
schema.

That is the standing lesson for D2. When the mainline is renamed again and the
demo follows it, the rename is not self-enforcing, and the vendored document is
what makes it so.

**The service half does not exist yet.** The endpoints are the service team's
to build, raised as N9. This change assumes the shapes in D1; if they land
differently, the client work is the adapter and the tests move with it. Nothing
here is worth building against a guess, so implementation waits on their
answer.

**An unauthenticated generation endpoint is abuse surface.** Fixed input and a
regeneration window make it cheap to serve repeatedly, but the exposure is real
and it is the service's to bound. Worth naming here because the client asked
for the no-auth property and therefore owns half the reason it exists.

**A demo that stops before execution may underwhelm.** Accepted, and preferable
to the alternative. The step it stops at is a signature gate, and explaining
why it stops is a better demonstration of the product than bypassing it would
be.

**A hidden topic is discoverable by anyone who reads the source.** It is not a
secret and does not need to be. It is out of the index so routing cannot reach
it, not so that people cannot find it.
