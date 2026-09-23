## Context

Two constraints shape every decision below.

**The prompts module must stay Worker-safe.** `packages/cli/src/prompts/`
is published as `@taskless/cli/prompts` and imported by Workers without
`nodejs_compat`, where a module-scope `process` read throws at import
time. `assert-library-graphs` in `vite.config.ts` fails the build if the
entry's chunk graph reaches a node builtin or the CLI entry. So the
prompts module cannot detect anything: it receives a value.

**Two serving paths must agree byte for byte.** `taskless onboard
--force` and `taskless agent onboard` print the same recipe, asserted in
`packages/cli/test/onboard.test.ts`, including under an npx-shaped
environment. Any state one computes, the other must compute identically.

## Goals / Non-Goals

**Goals.** Answer "can this flow mine PR comments?" once, in the CLI,
from evidence the CLI already has. Say why a source is missing when it
is missing. Build the substitution as a general mechanism.

**Non-Goals.** Verifying a binary. Detecting MCP servers. Adding a
subcommand.

## Decisions

### Presence, via `findOnPath`, and nothing else

`findOnPath(command)` in `packages/cli/src/rules/platform-binary.ts`
walks `PATH` and `existsSync`es a candidate. It executes nothing, which
is the whole property being bought: a detection pass that spawns
arbitrary binaries found on a user's `PATH` is a different and much
larger promise than the one this flow needs.

The recipe therefore states presence and never verification. The phrasing
is load-bearing: "`gh` is on your PATH; Taskless did not run it" is an
honest report of exactly what was measured, where "`gh` is available"
would be a claim about a working install that was never checked.

**Rejected: a hash tier.** Comparing the on-disk binary's sha256 against
published release digests. Measured and abandoned: GitHub publishes
checksums for `gh`'s release archives and installers, not for the
extracted binary, and the local Homebrew `gh` 2.97.0 matched 0 of 21
official digests. The tier would report "unverified" for the most common
install path on macOS, which a reader reads as "suspicious" rather than
"not checkable".

### `applicable` is a separate axis from `present`

A tool entry carries both. `present` is "a file of this name is on
`PATH`". `applicable` is "this tool could do anything useful here".

They are separate because they fail for unrelated reasons and the reader
needs different sentences. `gh` is not applicable when
`resolveRepositoryContext(cwd).ghOwner` is `UNKNOWN_GH_OWNER` — the repo
has no GitHub `origin`, so there are no pull requests to mine no matter
what is installed.

**Precedence: `not-applicable` outranks `absent`.** A GitLab repository
with `gh` installed must not be offered PR-comment mining, and must not
be told to install `gh`. Collapsing the two into one boolean would
produce exactly that wrong instruction.

Reusing `resolveRepositoryContext` rather than inventing a second
"is this GitHub" signal is deliberate: it is already the single
resolution behind `info` and telemetry, and a second one could disagree
with it.

### The variable is the whole block, connective included

`recipes.ts` already carries this pattern for `DETECT_EVIDENCE` and
`LOGIN_EVIDENCE`, with the reasoning written at the definition: the
prose around a substitution depends on it grammatically, so replacing
only the command leaves a dangling clause. Post-stripping text from a
rendered recipe has the same defect one layer later, and additionally
cannot promise the default rendering is unchanged.

So `%(SOURCE_PR_REVIEW)s` is an entire menu bullet — its own `-`, its
own bolded label, its own sentences — and `%(HOST_TOOLS)s` is an entire
numbered step including its title. In every state the surrounding
markdown is valid without the renderer knowing anything about markdown.

### Default is the full menu

With no `hostTools` the renderer emits the recipe's unconditioned text:
every source offered, no claim about what is installed. This is what
`@taskless/cli/prompts` gets, and it is the right answer there — a
Worker consumer has no `PATH` to speak of, and a recipe that dropped
sources because the _host_ lacked `gh` would be describing the wrong
machine.

### Where detection runs

At the same point `invocation` is detected, in both `commands/onboard.ts`
and `commands/agent.ts`. `agent` computes it only when the requested
topic's template actually contains a host-tool variable, asked of
`getRawRecipe(...).variables` rather than by hardcoding "onboard" — so
the next recipe to use the mechanism needs no change here, and topics
that do not use it pay no `git` spawn.

### `tools` means CLI binaries; harnesses are `harnesses`

`info --json`'s `tools` key has always carried agent harnesses. The
noun was wrong before this change and is unusable now, so it becomes
`harnesses` and `tools` carries what the word says. Consumers inside
this repository are the schema, the command, the `info` recipe's example
payload, and `cli.test.ts`; all move together in this change.

## Risks / Trade-offs

**A consumer outside this repository reading `tools`.** The key is
published in `info --json` output. Mitigation is the release note, not a
compatibility shim: pre-1.0, and an alias would make the wrong noun
permanent.

**`agent` gains a `git` spawn on the topics that use the variable.**
Bounded to those topics by the `variables` check above, and
`resolveRepositoryContext` never throws.

## Migration Plan

None required. The manifest is untouched; nothing persists detection.
