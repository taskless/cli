## Context

The CLI's `help/*.txt` recipes are the knowledge surface agents read. They are addressed longform (`positionals.join("-")` in `commands/help.ts`), exported in part through `@taskless/cli/prompts` for the platform generator, and cross-referenced from each other by literal command string — ~306 occurrences of `taskless help` across 77 files.

`add-vale-rule-engine` added `engine-selection`, which decides between `sg`, `vale`, and `runtime`. Two of those three answers have no authoring procedure. That change recorded Vale authoring as an explicit non-goal, which was defensible when nothing chose Vale; the chooser makes it reachable.

Separately, the scaffolded `.vale.ini` opens an unscoped `[*]`. A whole-project check under it lints build output and, until #100, `.taskless/` itself.

## Goals / Non-Goals

**Goals:**

- Every answer `route` can produce leads to a procedure that exists.
- One fetch from request to destination, returning a command an agent can run verbatim.
- A topic vocabulary that reads as literal tokens rather than paraphrasable phrases.
- A scaffold that lints nothing until someone scopes it deliberately.

**Non-Goals:**

- **A `.vale.ini` writer.** The agent authors the section, exactly as it authors `sgconfig.yml` rule entries today. Construction moves to the downstream generator, consistent with `add-vale-rule-engine/design.md:107`.
- Rule _generation_ for Vale via the service. `create-remote-rule` dispatches to the service as it does today; this change gives the local paths destinations and renames the remote one.
- Renaming the `cli-help` capability file. The command renames; the spec keeps its name, so this change does not also move spec files (see D5).
- Restricting Vale's feature set, or deciding build-output exclusion (tracked separately in #101).

## Decisions

### D1 — `route` and `engine-selection` merge into one topic

There is one decision, made once. `route` absorbs the engine reasoning and returns one of the five `create-*-rule` topics. `engine-selection` ceases to exist as a separate topic.

This reverses the scoping `engine-selection` asserts today — that route decides destination, the topic decides engine, and locally the two compose. The separation is clean on paper and expensive in practice: it costs an agent two fetches and a correct handoff between them to answer one question, and the handoff is where an agent drops context. Worse, the two decisions are not independent in the direction the split assumes; "author this locally" and "which engine can express it" are answered from the same evidence, so splitting them means reading the same signals twice.

**Where the reasoning goes for consumers outside the CLI.** The platform generator consumes `engine-selection` through `TOPICS`, so merging cannot simply delete what it reads. `route` is expected to be exported in a later change, at which point it carries the criterion to the service directly; it is not exported here because it still contains local mechanics (`taskless detect --json`, on-device authoring) that a Worker cannot run, and untangling those is its own piece of work.

The criterion therefore lives **once, in `route`'s destination table**, which is where the comparison is actually made. Restating it in each destination would be the drift risk the merge was meant to remove, one level down.

Each destination instead opens with a short orientation line naming what it is for and what to do if that is wrong — see D9. That is deliberately less than the full criterion: enough for a reader who arrived at the wrong recipe to notice and go back, not a second copy of the test.

**What this costs the exported surface, and for how long.** A consumer reading only `create-vale-rule` gets its scope ("prose and markup") but not the boundary cases that settle hard calls — prose-about-code, per-document versus cross-document. Sufficient for picking between destinations; not for adjudicating a genuinely ambiguous rule.

That gap closes when `route` is exported. The service will hold the route prompt, which states when each engine applies, and needs no escalation path of its own — it is the escalation. It can then supply its own runtime prompt for its own agentic flow.

Worth being clear about why the prompts are exported at all, because it changes what "enough" means: the goal is **consistency between the local and remote paths**, not transferring a capability the service lacks. The service can classify without us. What it should not do is classify _differently_ — a rule routed to `vale` locally and to `sg` server-side is the same request answered two ways, and that is the failure the shared surface exists to prevent.

_Alternative rejected:_ keep `engine-selection` as a third exported topic that `route` also applies. Two statements of the same criterion, guaranteed to drift, and it preserves the second fetch for exactly the consumer we were trying to simplify.

_Alternative rejected:_ restate the full criterion in every destination. Five copies of one test, and the first edit to any of them is a divergence nobody notices.

_Deferred, not rejected:_ export `route`. Its local mechanics need separating from its reasoning first, and doing that inside a change that already renames a command and five topics is how a rename becomes unreviewable.

### D2 — Verb-noun names, single token, no aliases

`create-sg-rule`, `create-vale-rule`, `create-runtime-rule`, `create-legacy-rule`, `create-remote-rule`. Not everything needs the noun — `route` stays `route`.

Hyphenated single tokens are the point rather than a side effect. A multi-word phrase invites an agent to paraphrase or reorder; a hyphenated token reads as a literal string to copy. This is the same reason the resolution stops joining positionals: with one token there is no order to get wrong.

`static` → `create-sg-rule` also removes a leak. "Static" is a trust tier, and `engine-selection` is explicit that tier and engine are different axes; naming the ast-grep authoring topic after the tier taught the confusion the other topic exists to correct.

_Alternative rejected:_ `static-sg` / `static-vale`. Preserves the tier leak and does not match what `route` decides.

### D3 — Break `TOPICS`, no deprecation window

`TOPICS` becomes `["create-sg-rule", "create-vale-rule", "create-runtime-rule"]`. `engine-selection` leaves the export because it stops existing (D1); the criterion it carried is now stated by the destinations themselves.

The package is pre-1.0, so this ships **MINOR**. That is what the leading zero means, and it holds for every backwards-incompatible item in this change. An alias would have to be carried by the type union (`PromptTopic`), the `PROMPTS` map, and the disjointness test, and would be dead the moment the generator updates.

The real exposure is not the rename but the **deploy skew**: the generator is a separate deploy consuming a published package, so it breaks on upgrade rather than at our build time. Mitigated by the changeset, not by code.

_Alternative rejected:_ export both names for one release. Doubles the exported surface to protect a single known consumer that we control.

### D4 — Section-less scaffold, and stderr notices as its precondition

The scaffolded `.vale.ini` carries `StylesPath` and `MinAlertLevel` and no section. Measured: Vale runs clean and reports `{}`.

This is only safe **with** stderr surfacing, and the two ship together. With no section to copy, the natural first edit is `rules.<id> = YES` at top level, which Vale reports as `W101 '<id>' isn't a core option; Vale is ignoring it` — on stderr, with exit 0 and valid `{}` on stdout. `runVale` reads stderr only on a non-zero exit, so today that diagnostic is discarded and the user gets: rule authored, `verify` passes, `check` silent. That is the exact failure the Vale work exists to eliminate, and shipping the scaffold change alone would reintroduce it one level up.

_Alternative rejected:_ scaffold `[*.md]`. A user's first rule works immediately, but the default silently decides scope for them, and markdown is a guess about what a repo's prose is.

### D5 — The `cli-help` capability keeps its name

The command becomes `agent`; the spec file stays `openspec/specs/cli-help/spec.md`.

Renaming a capability means moving a spec directory and rewriting every cross-reference to it in the same change that already renames a command and four topics. The capability's subject — the CLI's agent-knowledge surface — is unchanged; only its command name moves. Worth doing later on its own, and worth not doing here.

## Risks / Trade-offs

- **Generator breaks on CLI upgrade, not at build time** → `TOPICS` is consumed across a deploy boundary. The changeset must name the rename explicitly, and the generator's update is a coordinated follow-up rather than an assumption.
- **306 mechanical edits invite a missed one** → a stale `taskless help X` in a recipe is invisible until an agent runs it and gets nothing. Mitigated by an assertion that no shipped recipe contains the string `taskless help`, which is cheap and total.
- **Absorbing engine choice into `route` makes `route` longer** → it now carries the reasoning that justified a separate topic. If it grows past being readable in one pass, the split was load-bearing after all and should come back as a fetch.
- **A section-less scaffold means a fresh project's first Vale rule does nothing until scoped** → intended, and the reason `create-vale-rule` must teach the section rather than assume it. The stderr notice is what makes the failure legible instead of silent.
- **Telemetry vocabulary changes** → `cli_help` topic values change wholesale; anything keyed on `static` goes quiet rather than erroring. Worth naming before it is diagnosed as a traffic drop.

## Migration Plan

No user data or on-disk state migrates. Existing projects keep whatever `.vale.ini` they have — the scaffold change affects new projects only, and `0004` is unreleased, so no project has the old scaffold in the field.

The rename is a hard cutover in one PR: recipes cross-reference each other by literal command, so a partial rename produces recipes pointing at commands that do not exist.

### D6 — The logged-out gate is explained once, by `create-runtime-rule`

"Remote" describes who generates rather than which engine, so the two are not peers in kind — but the place that matters is the same place `create-runtime-rule` has to speak anyway: the user is logged out.

`create-runtime-rule` therefore owns the gated story — why executing code requires login, reconciliation, and signing, and how to get there. A logged-out user meets one topic explaining one gate, rather than being handed between a topic about remoteness and one about authentication.

**What this leaves unresolved, deliberately.** `remote.txt` and `rule-create.txt` today serve a real and different flow: the service generating an _ast-grep_ rule when local authoring cannot. That is escalation, not a destination — `route` is already specified as biased local with the service as last resort — so it survives as a fallback inside `route` rather than as a peer of the four. Whether those two recipes keep their names, merge, or fold into `create-sg-rule`'s failure path is not settled here.

_Alternative rejected:_ a fifth `create-remote-rule` destination. Puts a non-engine on an engine-shaped list, and splits the logged-out explanation across two topics.

### D7 — Login state is read early; remote is offered only where it is a choice

`route` reads login state near the top, before dispatching. It changes which destinations exist, so discovering it late means classifying against a set that may be wrong.

It does **not** follow that the agent should open by asking "do you want remote generation?". At that point it does not know whether the rule is a two-line `sg` pattern or something local authoring cannot express, and neither does the user — the question costs a turn and cannot be answered well. Remote is offered when it is genuinely a choice: the rule is locally expressible **and** the user is logged in. Not logged in, or not locally expressible, are not choices and are not posed as one.

This narrows the existing "biased to stay local" requirement rather than reversing it. The bias survives for the case it was written about — local authoring that _works_ is not abandoned for the service — while a logged-in user stops being steered away from a path they have already paid for.

**No topic delegates to another.** A logged-in runtime request routes to `create-remote-rule` directly; `create-runtime-rule` is the logged-out path. Routing runtime through a topic that then forwards would reintroduce the second fetch D1 exists to remove, and would split the login explanation across two files.

_Alternative rejected:_ offer remote unconditionally as step one. Reverses the local bias outright, and asks a question before the information exists to answer it.

_Alternative rejected:_ `create-runtime-rule` checks login and forwards. Two fetches, and the reader meets the gate explanation only on one branch.

### D8 — `remote` and `rule-create` merge into `create-remote-rule`

`remote.txt` states the client-side boundary; `rule-create.txt` is the procedure that enriches a description, calls the API, and reports. Split across two topics, an agent fetches one to learn it needs the other.

This is a content merge, not a rename: both texts have material that survives, and the result has to read as one procedure rather than two concatenated.

_Alternative rejected:_ keep `remote` as a boundary statement and `create-remote-rule` as the procedure. Preserves the second fetch under new names.

### D9 — Destinations orient, they do not re-decide

Each `create-*-rule` recipe opens with a fixed-shape line: what topic the reader is in, what kinds of rule it helps write, and an instruction to revisit the routing decision if that is not what they need.

Its job is self-correction, not classification. An agent that arrived at the wrong recipe — because it guessed, because a user named a topic directly, or because `route` was wrong — should discover that in the first line rather than after authoring the wrong artifact. Recovery is cheap there and expensive later.

Keeping it to orientation is what stops it becoming a second criterion. The comparison between engines happens in one place; a destination only has to answer "am I the right place", which needs its own scope and nothing about the others.

### D10 — `create-runtime-rule` defers to `auth`

It explains why the runtime tier is gated — executing code requires reconciliation and signing — and points at `auth` for obtaining access, rather than restating the login procedure.

An extra CLI turn is not a cost worth avoiding when each turn delivers something concrete: `auth` is maintained as the authority on login, and a copy inside a rule-authoring recipe is a copy that goes stale the first time login changes.

## Open Questions

- None outstanding.
