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
than a divergence signal.** Both are hardcoded to the rule-family endpoints and
both take a required `token`, which `createApiClient` turns unconditionally into
an `Authorization: Bearer` header. The demo is unauthenticated by requirement
(D3), so neither is usable as it stands: the endpoint has to be a parameter, and
the token has to be optional.

The path half of that resolves itself when the client adopts the renamed family,
which is out of scope here. The token half does not, and is the durable part.
Neither is evidence of anything having gone wrong — they are two small changes
to functions written when every caller was authenticated, and they are planned
in task 1.2a rather than discovered during implementation.

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

Adopting the new noun in the _ordinary_ client is a separate change and is not
this one's dependency. `/cli/api/rule/*` still serves, marked `deprecated`, so
the mainline client is not broken by having not moved yet — but the demo, being
new, has no reason to be born on the deprecated spelling.

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

The consequence is that this change demonstrates everything up to the gate. If
showing a blessed rule execute matters, logging in is the next beat, and it is
a better demo for being the payoff rather than the prerequisite.

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

## Risks / Trade-offs

**The demo is born on `request`/`requestId` while the ordinary client is still
on `rule`/`ruleId`.** That skew is deliberate (D2) and bounded: the `rule/*`
family still serves, marked `deprecated`, so nothing is broken by the mainline
not having moved yet. When it does adopt the rename, regenerating the types
catches most of it at compile time; two call sites build their URL as a
template string and would not fail to compile, so they are changed deliberately
rather than found later.

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
