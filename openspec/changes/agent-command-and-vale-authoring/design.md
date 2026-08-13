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
- Rule _generation_ for Vale via the service. `remote` remains the service path; this change gives the local path a destination.
- Renaming the `cli-help` capability file. The command renames; the spec keeps its name, so this change does not also move spec files (see D5).
- Restricting Vale's feature set, or deciding build-output exclusion (tracked separately in #101).

## Decisions

### D1 — `route` and `engine-selection` merge into one topic

There is one decision, made once. `route` absorbs the engine reasoning and returns one of the four `create-*-rule` topics. `engine-selection` ceases to exist as a separate topic.

This reverses the scoping `engine-selection` asserts today — that route decides destination, the topic decides engine, and locally the two compose. The separation is clean on paper and expensive in practice: it costs an agent two fetches and a correct handoff between them to answer one question, and the handoff is where an agent drops context. Worse, the two decisions are not independent in the direction the split assumes; "author this locally" and "which engine can express it" are answered from the same evidence, so splitting them means reading the same signals twice.

**Where the reasoning goes for consumers outside the CLI.** The platform generator consumes `engine-selection` through `TOPICS` and has no `route` step, so merging cannot simply delete what it reads. Exporting `route` instead is wrong — it is built on `taskless detect --json` and local authoring, neither of which a Worker can do.

The reasoning therefore **distributes to the destinations**: each `create-*-rule` recipe states the evidence that makes its engine the right one, and `route` applies those same tests to dispatch. A consumer choosing between `create-sg-rule` and `create-vale-rule` reads the criterion at the destination rather than fetching a chooser first. This keeps the exported surface honest — every exported topic is one a service-side consumer can actually act on — and it removes the class of drift where a chooser and its destinations disagree about when each applies.

_Alternative rejected:_ keep `engine-selection` as a third exported topic that `route` also applies. Two statements of the same criterion, guaranteed to drift, and it preserves the second fetch for exactly the consumer we were trying to simplify.

_Alternative rejected:_ export `route`. It is local-only by construction.

### D2 — Verb-noun names, single token, no aliases

`create-sg-rule`, `create-vale-rule`, `create-runtime-rule`, `create-legacy-rule`. Not everything needs the noun — `route` stays `route`.

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

### D6 — There is no `create-remote-rule`; `create-runtime-rule` covers the gated path

`route` names four destinations, all engine-shaped. "Remote" is not a fifth engine — it describes who generates, which is a different question, and the one place it bites is the same place `create-runtime-rule` already has to speak: the user is logged out.

So `create-runtime-rule` owns the gated story end to end — why executing code requires login, reconciliation, and signing, and what to do when the user has none of them. A logged-out user meets one topic explaining one gate, rather than being routed to a topic about remoteness that then explains authentication.

**What this leaves unresolved, deliberately.** `remote.txt` and `rule-create.txt` today serve a real and different flow: the service generating an _ast-grep_ rule when local authoring cannot. That is escalation, not a destination — `route` is already specified as biased local with the service as last resort — so it survives as a fallback inside `route` rather than as a peer of the four. Whether those two recipes keep their names, merge, or fold into `create-sg-rule`'s failure path is not settled here.

_Alternative rejected:_ a fifth `create-remote-rule` destination. Puts a non-engine on an engine-shaped list, and splits the logged-out explanation across two topics.

## Open Questions

- `remote.txt` and `rule-create.txt` are no longer named by `route`, but still implement service generation. Do they remain fetchable topics, fold into `create-sg-rule`'s escalation path, or merge with each other? Not settled by D6, and worth deciding before the sweep in task group 3 rewrites their cross-references.
- Should `create-runtime-rule` explain the login requirement itself, or defer to `auth`? Stated as the former; worth confirming it does not duplicate `auth`.
- Does the distributed engine criterion (D1) belong in each recipe's Preconditions or as a named section? Affects whether a consumer can extract it mechanically.
