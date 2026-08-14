## Context

`add-vale-rule-engine` established the Vale engine with a single committed `.taskless/vale/.vale.ini`: matchers express scope, precedence is positional, and `tskl) <name> = <value>` breadcrumb keys tag each Taskless-owned matcher with the rule that owns it. That breadcrumb exists specifically so tooling can find a rule's matchers "even when its scoping is split across multiple matchers" — a problem that only exists because every rule shares one file.

`agent-command-and-vale-authoring` then wrote the authoring recipe and executed it five times against sandboxed agents with no repository access. Every silent failure the runs found was in that shared file: an assignment above the first matcher (ignored with `W101` on stderr, exit 0), a glob that did not match the fixture extension, three names that must agree with nothing reporting when they don't. The recipe grew a debug ladder whose first four rungs are all "did you edit the shared config correctly".

The measurements this design rests on, taken against the bundled Vale 3.17.1:

- `rules/<id>/<id>.yml` resolves as check `<id>.<id>` under `StylesPath = rules`. Under `StylesPath = .` it resolves to nothing.
- Vale rejects unknown top-level keys in a rule file (`E201 has invalid keys: 'taskless'`), so per-rule scope cannot ride along inside the style.
- Vale's ini parser accepts and ignores `tskl)` keys.
- A `.yml` sidecar inside a style directory is parsed as a rule and fails `E201` when the style is enabled wholesale; a non-`.yml` file in the same place is ignored. A per-rule `.vale.ini` is therefore safe where a per-rule `.yml` would not be.

## Goals / Non-Goals

**Goals:**

- A Vale rule is one directory, complete on its own: style, scope, metadata, and nothing shared.
- No file is edited by more than one rule's author.
- A rule is addressable by path, so `verify` and `test` need no id lookup and no ambiguity rule.
- The silent-disable failure modes are removed by construction, not documented.

**Non-Goals:**

- Changing how ast-grep or runtime rules are laid out. `verify`/`test` become path-addressed for all three, but only Vale's on-disk shape moves.
- A GUI or interactive editor for matchers. The agent writes the per-rule `.vale.ini`, as it writes the style file.
- Supporting both layouts. There is one legal shape; the migration moves projects to it.

## Decisions

### D1 — A Vale rule is a directory containing its style and its own `.vale.ini`

```
.taskless/vale/rules/no-simply/
    no-simply.yml     # extends, message, level, scope, match, exceptions
    .vale.ini         # this rule's matchers, excludes, and tskl) metadata
```

The deciding argument is write contention, not tidiness. A shared config is a file every agent must edit and no agent owns, and it is where every silent failure was actually found. Splitting it means an agent writes only files it created, and a rule can be added, reviewed, or deleted as one directory.

It also makes the `tskl) rule = <id>` breadcrumb largely redundant for *locating* matchers — the directory answers that — though it stays as the marker of Taskless ownership within an assembled file.

`.vale.ini` rather than a `.yml` sidecar is load-bearing: measured, a `.yml` file inside a style directory is parsed as a rule and fails `E201` when the style is enabled wholesale. The ini extension is invisible to Vale's style loader.

_Alternative rejected:_ keep one shared config and lock or serialize writes. It preserves the failure modes and adds coordination to paper over them.

_Alternative rejected:_ put scope in the style file. Measured impossible — Vale rejects unknown keys.

### D2 — `StylesPath = rules`

Required by D1: it is what makes each rule directory a style, giving check name `<id>.<id>`. Under `StylesPath = .` a nested rule file resolves to nothing at all.

This reverses the note in migration `0004`, which calls `StylesPath = rules` wrong. That note was correct **for the flat layout** — with rules directly under `rules/`, pointing StylesPath at `rules/` makes each rule file a style directory with no rules in it, and every check silently resolves to nothing. The same setting is right for one layout and wrong for the other, which is why the note must be rewritten rather than deleted.

A side benefit: `rule-tests/` stops being a sibling style directory. Under `StylesPath = .` it sits beside `rules/` as something Vale would treat as a style; under `StylesPath = rules` it is outside StylesPath entirely.

### D3 — The run config is assembled at check time and gitignored

`check` reads every `rules/<id>/.vale.ini` and writes one `.taskless/vale/.vale.ini` for the run. It is a build artifact, not a source file, and it is gitignored — the same treatment the ephemeral `sgconfig.yml` already receives, and the same reason: a generated file that is also committed drifts from its inputs and invites hand edits that the next generation discards.

**Assembly order is a correctness constraint, not a formatting choice.** The spec's precedence rule is positional: across matchers the last wins, and within one matcher the first assignment wins. So assembly SHALL be deterministic — rules ordered by id, each rule's own matcher order preserved verbatim. A non-deterministic assembly would make a rule's effective scope depend on directory iteration order, which is the kind of bug that reproduces on one machine and not another.

This means a rule cannot express "override another rule's matcher", since it cannot know its position. That is a real loss and an acceptable one: cross-rule overriding through a shared file is exactly the coupling D1 removes.

_Alternative rejected:_ invoke Vale once per rule. Vale takes one `--config`, so N rules means N process spawns on every check, and findings would have to be merged from N JSON payloads.

_Alternative rejected:_ commit the assembled file. It would be the shared, write-contended file again, arriving by a different route.

### D4 — `verify` and `test` are separate commands, and `verify` is a layer of `test`

`verify <path>` answers "is this a well-formed rule" — required components present, schema satisfied. `test <path>` answers "does it behave" — ast-grep test cases, Vale `pass`/`fail` fixtures, the runtime harness.

They split because they have different preconditions. `verify` needs only the rule; `test` needs fixtures that may not exist yet. An agent mid-authoring wants the first before it can satisfy the second, and CI wants both.

`test` runs `verify` first and stops on failure. Today the composition is backwards: fixture coverage short-circuits before Vale ever parses the rule, so a rule with an invalid `level` and a half-written fixture set reports `fixtures: "fail-only"` and never surfaces `'level' must be one of [suggestion warning error]`. The error the author needs is hidden behind the one they don't.

### D5 — Paths, not ids

A path names one thing. An id does not: the same id can exist under `sg` and `vale`, which is why the id-based dispatch had to carry an ambiguity error at all. Deleting the addressing scheme deletes the error case.

The engine is resolved from the path's position under `.taskless/<engine>/rules/`, the same way `dispatch` resolves it — never by parsing the file. A path that is a directory means everything beneath it, so `verify .taskless/` is the CI form and `verify .taskless/vale/rules/no-simply` is the single-rule form.

_Alternative rejected:_ keep `rule verify <id>` as an alias. It preserves the ambiguity case for the convenience of a shorter argument, in a command agents invoke from a recipe that can just as easily carry a path.

## Risks / Trade-offs

- **The recipe changes again** → `create-vale-rule` currently teaches the flat layout in detail, and its nine worked examples were verified against it. The examples' rule bodies are unaffected — only where the file sits and where scope is declared. The harness (`agent-command-and-vale-authoring/tasks.md` 2b) re-runs against the new text, so this is bounded work with an existing verification loop.
- **Assembly is a new failure surface** → a bug there disables rules silently, which is the failure this whole engine's design exists to prevent. Mitigated by asserting on the assembled artifact's content, and by the existing stderr-notice path that surfaces Vale's `W101` when an assignment lands outside a matcher.
- **Cross-rule matcher overrides become impossible** → intended (D3), but worth stating: a project that wants "enable everywhere, disable in `legacy/`" must express both matchers within the owning rule's own config.
- **Two unreleased migrations in a row touch the same tree** → `0004` is unreleased, so no project in the field has the old scaffold, and the new migration is a no-op for anyone who never ran it. The risk is to this repo's own fixtures, which are covered by tests.

## Migration Plan

No user data is at stake: migration `0004` is unreleased and no Vale rules exist in the field. The new migration is written for this repository's own fixtures and for anyone running a pre-release build.

1. Move each flat `vale/rules/<id>.yml` to `vale/rules/<id>/<id>.yml`.
2. Split the committed `vale/.vale.ini`: each matcher carrying `tskl) rule = <id>` moves to that rule's directory; `StylesPath`/`MinAlertLevel` become assembly defaults.
3. Delete the committed `vale/.vale.ini` and add it to `.taskless/.gitignore`.
4. A matcher with no `tskl) rule` breadcrumb cannot be attributed to a rule. Leave it in place and report it rather than guessing an owner or dropping it — an unattributable matcher is a user's hand edit, and silently discarding it would change what their check reports.

## Open Questions

- None outstanding.
