## MODIFIED Requirements

### Requirement: Recipes name the CLI by its full invocation

Every instruction in shipped agent-facing content that tells a reader to run the Taskless CLI SHALL name the CLI by the invocation the build resolves for the reader, followed by the subcommand and its arguments — never by a hand-written one. Two mechanisms deliver that, because the content travels by two different paths:

- Recipe sources under `packages/cli/src/agent/` SHALL express the CLI as `%(TASKLESS_CLI)s`, which the recipe renderer substitutes at render time.
- `skills/taskless/SKILL.md` is not rendered through the recipe renderer, so it SHALL carry the canonical `npx @taskless/cli` string, which `applyCliInvocation` rewrites to the build target's invocation when the content is emitted.

Content SHALL NOT name the CLI as a bare `taskless` binary, because it is not installed on `PATH` for the overwhelming majority of readers. A recipe source SHALL NOT hardcode a launcher-and-package string such as `npx @taskless/cli` either, because that is the fact `%(TASKLESS_CLI)s` exists to hold in one place — the string is canonical only in the file above, where it is the rewrite anchor rather than a hardcoding. Prose that mentions the product, a config filename, or a directory (`taskless.config`, `.taskless/`) is unaffected — the requirement is about executable instructions.

An automated check SHALL fail when a bare `` `taskless <subcommand>` `` invocation, or a hardcoded `npx @taskless/cli`, appears in a recipe source, so the normalization cannot silently regress as recipes are edited. The check SHALL read the subcommand names from the CLI's own registry rather than restating them, so a newly added subcommand is covered without a second edit. It does not extend to `skills/taskless/SKILL.md`, whose rewrite anchor is the very string it flags and which quote invocations as example user utterances.

#### Scenario: A recipe instructs the reader to run a subcommand

- **WHEN** a recipe tells the reader to fetch another topic
- **THEN** the source SHALL read `%(TASKLESS_CLI)s agent <topic>` rather than `taskless agent <topic>` or `npx @taskless/cli agent <topic>`

#### Scenario: A regression is reintroduced

- **WHEN** a recipe source is edited to contain a bare `` `taskless check` ``-style invocation
- **THEN** the automated check SHALL fail and name the offending file and line

#### Scenario: Non-prod builds rewrite every invocation, not some of them

- **WHEN** a `nightly` or `self` build renders any recipe
- **THEN** every CLI invocation in the rendered text SHALL name that build's own invocation, with no occurrence left naming the released `@taskless/cli`

#### Scenario: Cross-reference checking survives the normalization

- **WHEN** the check that recipe cross-references cite only topics that resolve is run
- **THEN** it SHALL operate on rendered recipe text, where the invocation is a stable literal, rather than on source text where it is a placeholder
- **AND** it SHALL anchor on the invocation the running build actually renders, so the check does not pass vacuously under a `nightly`, `dev`, or `self` build whose rendered invocation names neither `taskless` nor `@taskless/cli`
- **AND** it SHALL fail when it finds no cross-reference at all, since an empty result is otherwise indistinguishable from every reference resolving
