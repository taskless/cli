# Design

## The method rule, stated first because it is the whole risk

**Every verdict comes from the process exit status and the structured JSON output. Never from grepping stdout for an error phrase.**

This is not style guidance. It has already produced one wrong answer in this project:

| Probe                                              | Verdict                                 |
| -------------------------------------------------- | --------------------------------------- |
| `sequence`, bare rule, grep for `has invalid keys` | "accepts any key" — permissive          |
| `sequence`, bare rule, actual behavior             | `panic: interface conversion: … is nil` |

A Go panic contains no `has invalid keys` string, so a phrase-grep scores a crash as a clean run. Run Vale with `--output=JSON`; on a config error it writes `{Line, Path, Text, Code, Span}` to **stderr**. The generator therefore models the outcome of a run as a closed set with no escape hatch:

```
clean         status 0, stdout parses as a findings map
diagnostic    status ≠ 0, stderr parses as Vale's JSON object, keyed on Code
panic         stderr contains a Go panic header
unrecognized  everything else
```

`unrecognized` is fatal at every call site. There is deliberately no branch that folds an unfamiliar shape into "fine", because that is the failure the corpus caught the first time and cannot be relied on to catch the second.

## What is derived and what is seeded

Four vocabularies, and they do not have equal standing.

| Vocabulary       | Oracle                                             | Discovers? |
| ---------------- | -------------------------------------------------- | ---------- |
| Check types (12) | `'extends' key must be one of [...]`               | **yes**    |
| Levels (3)       | `'level' must be one of [...]`                     | **yes**    |
| Per-check fields | `has invalid keys: '<name>'` — names the _bad_ key | no         |
| Scope operands   | none; an unknown scope is silent                   | no         |

The top two are self-enumerating: give the binary a sentinel and it names its own accepted set. A Vale release that adds a check type is picked up rather than merely failing a test.

The bottom two are **verified, not discovered**, and the difference is load-bearing. `E201` names the key you got wrong and never the ones you could have used, so a field table can only be built by proposing a candidate and asking. A real field nobody proposes is absent from the artifact, and the schema then rejects a rule Vale accepts — the too-strict direction, which the design of the schema itself ranks as the worse failure. The candidate list is therefore seeded from four independent sources and its provenance is documented in the generator:

1. Vale's published key documentation, **including names the binary rejects** — `prefixes`, `suffixes`, and `ignorecase` on `capitalization` stay in the list precisely so their rejection is a recorded finding rather than an omission.
2. The hand transcription this replaces, so the generator is a superset of what a human already established.
3. Vale's shared keys: `link`, `limit`, `action`, `scope`, `description`, `name`, `comment`, `vocab`.
4. Every check's fields offered to every other check. That cross-probe is what makes the per-check tables a measured _partition_ rather than twelve unrelated lists.

## Membership, and the two inferences

The probe sets a candidate key to an arbitrary value (`true`) and reads the outcome as evidence about the **key**, not the value:

| Outcome                                   | Verdict          | Why                                                       |
| ----------------------------------------- | ---------------- | --------------------------------------------------------- |
| clean                                     | member           | the key decoded                                           |
| `has invalid keys` naming this field      | **not** a member | the only negative oracle Vale offers                      |
| any other `E201`                          | member           | Vale knew the key and objected to the value               |
| panic                                     | member           | an unknown key is collected as unused, never dereferenced |
| invalid-key list naming a _different_ key | fatal            | the base rule is contaminated                             |

The last two rows of the positive column are inferences rather than readings, so both are collected and written into the divergence report. On Vale 3.18.0 the type-complaint case fires ten times, all `action: expected a map, got 'bool'`, and the panic case fires zero times. An inference nobody can audit is a grep with better manners; naming them is what keeps the distinction real.

Two probes are excluded by construction rather than measured:

- **The header keys.** `extends`, `message` and `level` are in every base rule and were verified running clean. Probing them is also unsound: `extends: true` reaches an `interface{}` → `string` conversion and panics.
- **The sentinel.** The one probe where a panic is _not_ read as evidence. It decides whether a check validates keys at all, and a permissive verdict taken from a crash would make the schema loose for a check that is strict — which is precisely the `sequence` error, re-run.

Each check needs a **base rule**: a minimal working rule of that check to add the candidate to. That is hand-seeded and has to be, since several checks are not valid empty. Every base is verified clean before a single verdict is taken against it.

**Common fields are derived, not declared.** They are the _intersection_ of the ten strict checks' measured tables. That is a stronger statement than a hand-written list: nobody had to remember that `vocab` is per-check because five checks reject it — the intersection simply does not contain it. The permissive checks are excluded because they accept everything and so constrain nothing.

## Scope: three-valued, and only a fixture separates two of the values

`scope` has no oracle at all. An invalid scope does not fail — the rule loads, runs, and matches nothing, which from outside is identical to a valid scope whose construct is absent from the document. So the verdict is three-valued:

| Verdict       | What happened                                     |
| ------------- | ------------------------------------------------- |
| `fires`       | the rule flagged the fixture: the operand is real |
| `silent`      | the fixture was linted and the rule found nothing |
| `unreachable` | the fixture was never linted at all               |

Only a hand-written fixture separates the middle from the last, and the generator refuses to guess: every fixture contains the word `bogus`, a `scope: raw` **reach probe** must fire on it, and if it does not the run is fatal. That guard is not theoretical — `figure.caption` measures `silent` when its fixture nests the caption inside a `<figure>`, and so does `scope: text` over the same document, because Vale drops everything inside that element. Without the reach guard the operand would be dropped as one Vale ignores, and every rule using it would then fail `verify`.

The file extension is part of the fixture, not a detail: it decides which parser Vale routes the document to, and `comment.*` only exists in a source tier.

## Divergences are reported, not resolved

Where the binary and the documentation disagree, a generator that dropped the finding would be quietly deciding which to believe. The artifact carries `VALE_DIVERGENCES` and the run writes `vale-vocabulary-report.md`. Measured on 3.18.0:

- **`meta` and `meta.class.<kind>` are documented and never fire.** Omitted from the vocabulary, so `verify` rejects them. A rule written from the docs would otherwise be inert forever with no error anywhere.
- **`frontmatter` and `frontmatter.<key>` fire and are documented nowhere.** Included. This is the standing proof that a candidate list verifies rather than discovers: nobody proposing from the documentation alone would have found them.
- **`consistency` and `spelling` validate no keys at all**, measured with a sentinel. The schema stays permissive there; being strict would reject rules the binary runs.
- **Ten field probes drew a type complaint rather than a key rejection**, all on `action`. Recorded as members, and named so the inference is auditable.

Three claims carried into this change from earlier measurement did **not** reproduce, and the report is where that surfaced:

- `figure.caption` does fire, on a _bare_ `<figcaption>` in an `.html` document. What never fires is the nested-in-`<figure>` form, and the earlier note conflated the two.
- `comment.block` fires — in `.js` and in `.ts` alike. It does not "never fire while `comment.line` catches both".
- `comment.*` does not need a `.ts` fixture specifically; `.js` reaches the same tier. Rows for both now exist in the corpus, because "fires in a source file" and "fires in _this_ source file" are different claims and the schema makes the wider one.

## What stays hand-written, and why each is not a generation failure

- **The three fatal shapes.** A tokenless `sequence`, a `sequence` whose `tokens` is not a list, a `metric` with a `formula` and no `condition`. Every key in these rules is a legal field of its check — it is the _shape_ that is fatal, so a field table cannot express it. A panic is also a wider blast radius than `E201`: no rule name, no findings for anything, nothing to act on.
- **The scope grammar.** `~` negation and `&` chaining are operators around the operands, not values in the enum. Rejecting `~fenced` is a deliberate business rule, not a transcription, and the corpus carries it as a recorded divergence.
- **The union members.** They are spelled out rather than mapped over the generated table, because that is what carries each `z.literal` into `ValeRule`; a mapped union infers `extends: string`. The cost is a hand-maintained list beside a derived one, so an import-time guard requires every derived check type to appear exactly once and to be classified strict or permissive. The failure is a sentence naming the check.
- **The version pin.** The artifact records the version it was derived from, and `vale-rule.ts` asserts it against `VALE_VERSION` — as a **conditional type**, not an `if`. Both are string literal types, so the compiler settles it and a mismatch is a build failure naming the line, rather than a throw in front of a user on whichever command loads the schema first.

## Alternatives considered

**Generate the zod schema itself.** Rejected. The interesting content of `vale-rule.ts` is not the enums; it is the error messages that explain blast radius to an author, the two-stage `.pipe()` that reproduces the binary's own order, and the case-folding transform. Generating that would mean maintaining a code emitter to reproduce prose. Generating only the vocabulary keeps the derived part small and the reviewed part readable.

**Emit JSON, like `ast-grep-rule-schema.json`.** Rejected. That file is JSON because upstream publishes JSON. Here the generator authors the artifact, and a `.ts` file gets `as const` — which is what makes `VALE_CHECK_TYPES` a literal union rather than `string[]`, and the import-time guard checkable at all.

**Keep the transcription and add a checked-in probe script.** Rejected: two sources of truth that agree only by discipline. The failure mode is the one already observed — the answer survives, the question does not.
