# Align the CLI with the generator's rule-delivery payload

## Why

The Cloud Generator was days from switching on rule generation against a payload
the CLI cannot consume. The gap is not a field mismatch — it is structural.

`GET /cli/api/rule/{ruleId}` returns `rules[].content`: a single, flat ast-grep
rule object. That was the right shape when static ast-grep generation was the
only consumer. But `ENGINE_LAYOUTS` defines a rule as a **directory**, and for
two of three engines the extra files are what make the rule run at all:

| Engine    | Complete rule                           | Response can carry it |
| --------- | --------------------------------------- | --------------------- |
| `sg`      | `<id>.yml`, `.tests/`                   | rule only             |
| `vale`    | `<id>.yml`, `.vale.ini`, `.tests/`      | rule only             |
| `runtime` | `check.ts`, `captures/*.yml`, `.tests/` | nothing               |

Each missing artifact fails the same way, and it is the worst available way: the
rule is written, the command succeeds, and nothing is reported. A runtime rule
with no delivered `check.ts` is never blessed, so it is held in `unknown[]`. A
Vale rule with no `.vale.ini` has no matcher enabling it, so it never fires. In
both cases `check` exits `0`, and a rule that never ran is indistinguishable
from a rule that passed.

The generator team confirmed the prediction against their own code: the runtime
build path computed `canonicalHash(rule.check)` and discarded the result, and
never wrote to `rules[]` at all. Every generated runtime rule would have
reconciled into `unknown` and silently never run.

The contract is now agreed on both sides (G1–G7, C1–C3, A1–A4). This change is
the CLI's half of it.

## What Changes

**A rule arrives as a file set.** `files: [{ path, content }]`, relative to
`.taskless/rules/<engine>/<id>/`, validated against `ENGINE_LAYOUTS` — the table
the CLI already holds. One shape for three engines and the fourth not yet
invented. Existing `content` entries stay valid; `files` and `content` are
mutually exclusive.

**The layout table becomes publishable data.** The generator needs a
machine-readable copy to build against, or "the client owns the shape" degrades
into "the server transcribes it and drifts". `engines.ts` currently imports
`node:fs/promises`, so the pure data must separate from the path helpers before
it can be exported — the same split `@taskless/cli/prompts` already has, with
the build failing if the published graph reaches a host capability.

**Silent drops become loud.** `discover.ts` has five paths that skip a runtime
rule with no diagnostic, and `deleteRuleFiles` hardcodes `sg` so a delivered
vale or runtime rule can be written and never removed.

**Two declared invariants get enforced instead of trusted.** `check.ts` is the
only executable file in a runtime rule, and `RUNTIME_CHECK_PROTOCOL_VERSION` /
`metadata.taskless.version` are read by nothing today.

Writing server-supplied paths to disk is a new directory-traversal surface that
did not exist when the response carried one structured object. Absolute paths,
`..` segments, and anything outside the engine layout are refused before any
write.

## Capabilities

### New Capabilities

- `cli-generated-rule-delivery`: receiving a multi-file rule from the generator
  — validating the file set against the engine layout, refusing unsafe paths,
  and writing the rule directory atomically.
- `cli-layout-export`: publishing `ENGINE_LAYOUTS` and the directory constants
  as data for the generator to build against, from a graph free of the CLI
  runtime.

### Modified Capabilities

- `cli-rule-reconciliation`: the reported `file` spelling becomes contractual
  rather than incidental, and a rule reported `unsafe` or `unknown` gains a
  re-fetch path instead of only a warning.
- `cli-runtime-rule-execution`: a capture rule whose `match` mode this build
  does not implement is refused rather than coerced; a runtime rule directory
  holding any `.ts` but `check.ts` is refused; the protocol and metadata
  versions are read.
- `cli-rules`: deleting a rule resolves its engine instead of assuming `sg`.

## Impact

**Code.** `rules/engines.ts` (split), `rules/files.ts`, `rules/inspect.ts`,
`rules/dispatch.ts`, `rules/runtime/{discover,run-set}.ts`,
`types/runtime-rule.ts`, `api/{client,reconcile,rules}.ts`, `commands/rules.ts`,
plus a new writer and a new published entry point in `package.json` `exports`.

**Contract.** The generated `src/generated/api.d.ts` is regenerated from their
schema once the file-set tier ships. No change is required for tiers `≤ 0.10.2`
or `0.11.x`, which are served the old shape by version negotiation.

**Cross-team.** One item is theirs, not ours: they currently register
`<id>-<batch>/check.ts` while the CLI reports the repo-relative
`.taskless/rules/runtime/<id>/check.ts`. Until those agree, a tampered check
reports `unknown` ("never issued") rather than `unsafe` ("content changed in
place") — a diagnostic downgrade on the one path where the diagnosis matters.

**Docs.** Seven stale `.taskless/<engine>/rules/` comments describe a
pre-migration layout. Two further occurrences in the migration files are
legitimately historical and stay.

## Delivery shape

**Stacked, merging forward.** Each unit is independently safe in production and
leaves `check` green on its own; none depends on a later slice to be correct.

1. Stale path comments, and `deleteRuleFiles` engine resolution.
2. Split `engines.ts`; publish the layout table. Unblocks the generator.
3. Loud diagnostics for the five silent discovery drops; read the version
   fields.
4. Enforce `check.ts` as the only executable file in a runtime rule.
5. The file-set writer, including path safety.
6. The re-fetch path for `unsafe` / `unknown`.

The changeset belongs on the bottom branch and grows as the stack grows.

Slice 5 is the only one that could exceed ~1200 lines of hand-written change; if
it does, the writer and its validation split along the `ENGINE_LAYOUTS` boundary
rather than along the test seam.

Not in scope: `route`'s prompt export, which is tabled pending a separate
decision on whether it should carry host-supplied destinations as data.
