## Why

The signature envelope is self-describing about **how** a signature was
computed and silent about **what** it covers. `cli-rule-reconciliation`'s
`Canonical rule signature envelope` requirement says the algoVersion determines
"the normalization procedure and hash algorithm" and stops there. Which file a
rule's signature is over is agreed between the two teams and written down in
neither specification.

That gap surfaced when the generator team proposed moving `signature` from the
rule onto each file, on the grounds that "nothing in the payload says which file
the signature covers". The observation was right; the remedy was not. The
binding is a property of the signature scheme rather than of any particular
delivery, so it belongs in the envelope's definition, not distributed across the
collection. The proposal was declined and this statement is what we owe instead.

Stating it also answers the question the proposal was really reaching for: what
happens when an engine needs to sign more than one file. A new algoVersion is
the mechanism that already exists for changing what a signature means, so a
multi-file signature is a v2 signature rather than a new payload shape.

## What Changes

**The envelope's version states its coverage, not only its computation.** A v1
signature covers exactly one file, the engine's `ruleFile` from the layout table
— `check.ts` for runtime. An engine that needs to sign more than one file does
so under a later algoVersion.

This is a documentation-level change to a requirement, not a behavioural one.
No signature changes, no payload changes, and nothing recomputes. The CLI
already signs exactly the rule file and already reads the algoVersion before
parsing parameters; this says so where a reader looks for it.

## Capabilities

### Modified Capabilities

- `cli-rule-reconciliation`: The canonical signature envelope requirement gains
  the coverage statement and the versioning rule for changing it.

## Impact

- `openspec/specs/cli-rule-reconciliation/spec.md` — one requirement, amended.
- No source changes. `ALGO_VERSION` stays 1 and `signRuleFile` keeps signing the
  rule file it already signs.
- Recorded with the generator team in the cross-team document (round thirteen),
  where the per-file proposal was declined and this was offered in its place.
