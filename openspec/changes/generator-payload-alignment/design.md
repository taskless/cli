# Design

## Context

Two teams, one wire. The CLI owns what a rule _is_; the Cloud Generator owns the
envelope it arrives in and which shape a given client is allowed to see. That
split is agreed, and it is the frame for everything below.

The generation response was designed when static ast-grep was the only consumer:
`rules[].content` is one flat rule object. `ENGINE_LAYOUTS` says a rule is a
directory, and for two of three engines the extra files are what make it run.
The failure is uniform and silent — the rule is written, the command succeeds,
`check` exits `0`, and a rule that never ran is indistinguishable from one that
passed.

Settled across three rounds: G1–G7, C1–C3, A1–A4. The generator has shipped G1
(signature registration), A3 (path spelling), a version-negotiation table, and a
delivery guard that drops entries carrying no `content`. Their file-set
serializer and the re-fetch endpoint are in progress.

### Constraints we do not get to choose

- **Every published CLI is fixed.** `0.10.2` alone saw 915 downloads in a week.
  Forward compatibility cannot be applied retroactively, so anything old clients
  must survive is the server's problem, solved by version negotiation.
- **The digest is over `normalize(text)`.** BOM, CRLF, and trailing newlines
  fold away before hashing, which is what makes JSON-string transport of source
  code viable at all.
- **`check.ts` is the only executable surface**, and the only signed artifact.
- **The reported reconcile path is contractual now.**
  `.taskless/rules/runtime/<id>/check.ts`, repo-root-relative POSIX, separators
  normalized so Windows reports the same string.

## Goals / Non-Goals

**Goals**

- Receive a multi-file rule and write it correctly for any engine.
- Publish the layout table as data so the generator builds against it rather
  than transcribing it.
- Convert every silent drop on the runtime path into a stated reason.
- Enforce two invariants currently only declared: one executable per runtime
  rule, and the protocol/metadata versions being read at all.

**Non-Goals**

- The `route` prompt export. Tabled pending a separate decision about
  host-supplied destinations.
- Changing what tiers `≤ 0.10.2` and `0.11.x` receive. Both keep today's shape
  forever; that is the point of the ladder.
- A client-side migration for rules already on disk. The layout is already
  correct there; this change is about what arrives next.

## Decisions

### D1. A rule on the wire is a file set, validated against `ENGINE_LAYOUTS`

`files: [{ path, content }]` relative to `.taskless/rules/<engine>/<id>/`.

_Alternative considered:_ an engine-shaped variant per engine — a `runtime`
entry with `check`/`captures`, a `vale` entry with `config`. Rejected because it
adds a wire shape per engine and the client would still have to reconcile each
against `ENGINE_LAYOUTS`. One shape answers "is this a complete rule" from a
table that already exists.

_Alternative considered:_ keep `content` structured and add sibling fields.
Rejected because `check.ts` is source text; the moment one field is text the
uniform treatment is text, and text is what the signature is computed over.

### D2. Writing server-supplied paths is a new attack surface, refused before any write

Absolute paths, any `..` segment, and anything the engine layout does not
account for are rejected before the first `mkdir`. This did not exist when the
response carried one structured object whose destination the client computed
itself.

Note the existing precedent: `discoverRuntimeRulesIn` already refuses to resolve
`metadata.taskless.check` as a path, precisely so an arbitrary value cannot
point execution outside the rule directory. Same reasoning, new entry point.

### D3. The layout table is published as data, from a runtime-free graph

`engines.ts` imports `node:fs/promises`, so it cannot be imported by a Worker.
The pure data (`ENGINES`, `ENGINE_LAYOUTS`, `RULES_DIRECTORY`,
`RULE_TESTS_DIRECTORY`) separates from the path helpers.

Published as **`@taskless/cli/layout`** — named for what it exports rather than
for the file it came from, since `engines` suggests execution. Enforced the way
`@taskless/cli/prompts` is: a build plugin fails if the published chunk graph
reaches a host capability, so the constraint cannot rot into a comment.

_The deadlock, and who breaks it._ We would be publishing a table with no
consumer to prove it usable from a Worker; they would be holding the serializer
that is the only thing that could prove it. They are breaking it from their end
by building against a mock. That is the cheaper direction: a wrong guess costs
them one file, where a published entry with the wrong shape costs us a released
export we have to keep.

### D4. Silent drops become stated reasons, and the split is deliberate

Discovery **fails closed** on the execution path; `verify` **explains**. Neither
alone is sufficient — a refused capture that says nothing is just a different
route to "reports nothing".

Already implemented for the `match` mode (G7) on `fix/refuse-unknown-match-mode`
and used as the template for the remaining four drops: unreadable directory,
unparseable YAML, wrong `kind`, missing `language`/`name`/`id`.

### D5. Re-fetch is keyed on rule id **and** signature, not signature alone

The signature is content-addressed, so the digest alone identifies the bytes.
The rule id is still required, for two reasons: it makes the request
diagnosable in logs, and it lets the server scope the lookup to the caller's
corpus. Reconcile already carries `orgId` and `repositoryUrl` and re-fetch
should be scoped identically, so a bare digest cannot be used to fish for
content across orgs.

Returns the bytes matching the held signature, never the newest generation —
answering with something newer would upgrade a rule mid-`check` without anyone
asking. Upgrading is regeneration, and should be something a person requested.

### D6. The middle tier is not merely empty today — it may be empty permanently

The generator noticed that the `engine`-discriminator tier currently carries
nothing: `sg` is the only engine deliverable as a single file, and an absent
`engine` already means `sg` permanently via `resolveIngestEngine`. So the
`engine` envelope and the legacy envelope are byte-identical for everything they
can produce, and emitting `engine: "sg"` to `0.11.x` would spend compatibility
risk to say what the field's absence already says.

**It follows from G2 that this is not temporary.** `vale` was the expected
occupant of that tier, and G2 settled that a Vale rule cannot be delivered
without its `.vale.ini` — which requires the file set. So no engine other than
`sg` is deliverable as a single file, and the middle rung has no future
occupant either. Keep it defined, expect it to stay unused, and do not emit
`engine` before the file-set tier.

## Risks / Trade-offs

**The delivery path writes to a pre-`0004` location.** The generator delivers
into `.taskless/runtime-rules/<dir>/`; migration `0004` moves it to
`runtime/rules/<dir>/` and `0005` to `rules/runtime/<dir>/`, taking the
directory name verbatim as the rule id. The path they register is therefore the
_post-migration_ path — correct, but it means delivery depends on migrations
running before the first reconcile. Worth an explicit test rather than an
assumption, since nothing currently states it.

**Naming the file-set floor too early ships an unreadable shape.** If we name a
release and the writer slips past it, the generator emits a file set to a client
that cannot parse it. Their tier is unreachable by construction until we name a
number, and a test asserts no version resolves to it — so the safe move is to
name it only once the writer is on `main`.

**A published export is permanent.** `@taskless/cli/layout` becomes API held for
a major version. The mitigation is that its content is a table already relied on
internally, so it is not new surface area so much as newly visible surface area.

**Slice 5 may exceed the ~1200-line review budget.** If it does, the writer and
its validation split along the `ENGINE_LAYOUTS` boundary rather than along the
test seam, so neither half lands without the tests that prove it.
