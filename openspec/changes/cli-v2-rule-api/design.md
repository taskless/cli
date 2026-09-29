## Context

The server contract is taskless/taskless#229 (`rules-by-id`) and the live
`GET /cli/api/v2/__schema`. The schema is authoritative over any prose hand-off,
including the one this change was planned from.

Where the CLI stands at `86799ef`:

- **Reconcile covers runtime `check.ts` only.** `planRuntime`
  (`rules/runtime/plan.ts`) signs each `check.ts` (`signRuntimeChecks`), posts
  `{ files: [{ file, signature }] }` to v1 reconcile, joins `run` back by
  signature, then copies blessed rules into `.taskless/.run/runtime-rules/`
  (`materializeRuntimeRules`). sg and vale are assembled from the live tree by
  `rules/assemble.ts` and never reconciled.
- **`check` repairs in place.** `repairWithheldRules` calls restore for every
  `unsafe` and `missing` entry and writes the result into `.taskless/rules/`
  during the run. Every one of those restores 404s (TSKL-307).
- **Generation is ticket-addressed.** `rule create` reports the generation
  request id as `ruleId` in `--json`, and `rule improve` takes that value back as
  its `ruleId`. v2 addresses a rule by its directory name, `<kebab>-<8 hex>`,
  stable across iterations.
- **Assembly is root-relative.** The assembled Vale config sets
  `StylesPath = rules/vale` relative to its own location, and the sg config sets
  `ruleDirs: rules/sg` the same way. Vale is spawned with an explicit `--config`.
  Pointing both at a different root is a path change, not a redesign.

## Goals / Non-Goals

**Goals:**

- One snapshot per `check`, from which every engine runs and every signature is
  computed.
- One verdict table, applied per engine, with no path that fails silently open.
- Recovery (restore, rollback) as explicit commands that never write unverified
  bytes.
- A v2-only client, typed from the vendored v2 schema.

**Non-Goals:**

- Listing a rule's revisions. v2 has no endpoint for it; rollback takes a
  `revisionId` from the dashboard until one exists.
- Closing the directory-swap gap (an issued rule deleted and replaced by an
  `unknown` copy) or warning on superseded revisions. Both need server-side
  policy and are filed as follow-ups.
- Reading plan features up front. `whoami` does not return them; a refusal is how
  the CLI learns.
- Changing `verify`, `test`, or anonymous authoring. They are author tools that
  run what is on disk by the user's own request.

## Decisions

### 1. v2 is vendored beside v1, and v1 is deleted at the tip

`fetch-api-schema.ts` reads `/cli/api/v2/__schema` into `api-v2.schema.json` /
`api-v2.d.ts`. The v1 `api.schema.json` / `api.d.ts` stay frozen (never
refetched) until slice 5 deletes them with their last caller. After this change
nothing the CLI calls is in v1: whoami and the hash vectors have v2 twins
(measured byte-identical on 2026-09-29), and `/cli/auth/*` is outside both
schemas and already hand-typed.

_Alternative:_ replace `api.d.ts` with v2 in slice 1. Rejected: every v1 caller
(`api/rules.ts`, `api/restore.ts`, `auth/org.ts`) would fail typecheck until
slice 5, so every PR in the stack would be red and review would happen against
code that does not compile. The v2 name is kept after v1 is gone because the
server versions its API in the path, and the file should say which one it is.

All v2 calls go through one `openapi-fetch` client that sets
`x-taskless-cli-version` on every request, replacing the hand-rolled `fetch` in
`reconcile.ts` and `restore.ts`. Their "never throw on expected conditions"
contract is kept by mapping the typed error union to outcome values in one
place, not by staying on raw `fetch`.

### 2. One snapshot per `check`, taken before anything is signed

`check` copies `.taskless/rules/` to `.taskless/.run/snapshot/.taskless/rules/`
first (replacing any previous snapshot). The snapshot **mirrors the project's
layout** under a base directory, `.taskless/.run/snapshot/`, so every existing
path helper and both assemblers work unchanged when handed that base in place of
the project root: the assembled configs land at
`.taskless/.run/snapshot/.taskless/.vale.ini` and `.sgconfig.yml`, and their
root-relative `StylesPath` and `ruleDirs` resolve into the snapshot. The engines
still run from the project root, with only the config path changed. Everything
after the copy reads only the snapshot: signing, reporting, config assembly, and
all three engines. Runtime rules execute from the snapshot, replacing
`.run/runtime-rules/`.

Measured before building on it (task 4.1): the mixed-engine fixture plus a Vale
rule scoped to `[docs/**/*.md]` produced the same seven findings across five
rules from both config locations, and the subdirectory-scoped rule fired on
`docs/deep/a.md` and not on a top-level file in both.

The run directory ignores itself (`.taskless/.run/.gitignore` holds `*`), rather
than `check` adding `.run/` to the tracked `.taskless/.gitignore`: a `check` that
rewrote a tracked file would contradict "check writes only under `.taskless/.run/`",
and the first lint run on this repository after the change did exactly that. git,
ast-grep, and Vale all honor the nested file; a test runs both engines with no
outer ignore entry and gets identical findings.

The snapshot is taken on every path, including unauthenticated and
`--anonymous`, so there is one execution path rather than a verified one and an
unverified one that drift apart.

The copy **dereferences symlinks**. What is signed has to be what runs, and a
symlink resolved at run time is bytes nobody signed. A link that does not
resolve drops the file from the snapshot, which then shows up as a missing file
in the verdict rather than as a surprise at run time.

A rule excluded from the run by its verdict (`unsafe`, `withheld`, runtime
`unknown`) is removed from the snapshot before assembly, so exclusion is a fact
about the tree the engines read and not a filter each engine must remember.

_Alternative:_ copy only the rules that `run`, as today. Rejected: it keeps the
sign-then-copy window this change exists to close, and it cannot cover sg and
vale, which run whatever the verdict for `unknown`.

`verify` and `test` keep assembling from the live tree at the existing paths.

### 2a. Every run gets its own run directory, removed when the run ends

The snapshot started as one shared `.taskless/.run/snapshot/`, replaced at the start of every
run. Two concurrent runs (a pre-commit hook during an editor's on-save `check`) then shared
it: the second deleted and re-copied the tree the first was still reading, so the first could
run a half-copied tree, or a copy whose signatures it never checked. That is the exact failure
the snapshot exists to prevent.

So each run works in `.taskless/.run/<runId>/`: `<timestamp>-<random>`, sortable and unique.
It holds the snapshot, the assembled configs, an `owner` record (pid, host, start time), and
four logs: `engine.log` (the plan), `sg.log`, `vale.log`, `runtime.log`. It is removed in a
`finally`, and synchronously on SIGINT/SIGTERM before the signal is re-raised.
`--preserve-logs` (`-l`) keeps the WHOLE directory rather than only the logs, because the logs
name files by their snapshot paths and "what exactly ran" is usually the question
(product decision, 2026-09-29).

A SIGKILL skips all cleanup, so every run first sweeps directories whose owner process is gone
on this host, plus ownerless ones left by earlier versions (0.11's `runtime-rules/`). Liveness,
not age, is the test (product decision): an age limit either deletes a slow live run or keeps
junk for hours. A directory owned by another host is left alone; that only arises on a shared
filesystem, and this host cannot tell whether the process lives.

`.taskless/.run/.gitignore` (`*`) is written only if missing, since concurrent runs would race
on it.

### 3. What is reported for a rule

One `{ ruleId, files }` per directory under `.taskless/rules/<engine>/`, where
`ruleId` is the directory name and `files` lists every regular file under it,
recursively, except anything under `.tests/`. Paths are relative to the rule
directory, POSIX. Each signature is `canonicalHash` over the snapshot's bytes,
unchanged from v1.

A small fixed set of operating-system metadata files (`.DS_Store`,
`Thumbs.db`, `desktop.ini`) is neither copied into the snapshot nor reported.
The server treats any extra file as `unsafe`, and a Finder window must not fail
CI. Excluding them is safe only because they are also absent from what runs; the
list is closed, and nothing an engine reads can be on it.

`--rule` narrows what runs, never what is reported. Reporting a subset would
make every unselected issued rule `missing`.

### 4. Rule ids are unique across engines, or `check` stops

v2 ids are unique across engines and reconcile carries no engine. Two local
directories with one id under different engines therefore cannot be judged, and
the CLI refuses the run before reconcile, naming both directories.

It fails rather than skipping the pair. Skipping would let anyone neutralize an
issued `sg/foo-3fa9c21b` by creating `vale/foo-3fa9c21b`, because the issued rule
would then leave the report and run as if it were local.

### 5. The verdict table, and what "excluded" means per engine

| Verdict           | runtime       | sg / vale     | Exit                               |
| ----------------- | ------------- | ------------- | ---------------------------------- |
| `run`             | execute       | run           | —                                  |
| `withheld`        | not executed  | (never sent)  | fail                               |
| `unsafe`          | not executed  | **not run**   | fail for sg/vale; runtime as today |
| `missing`         | nothing local | nothing local | warn                               |
| `unknown`         | not executed  | run           | —                                  |
| not accounted for | not executed  | **not run**   | fail                               |

An `unsafe` static rule is **not run** as well as failing. Its findings would be
the edited rule's findings, and the run is already failing; showing them invites
reading the failure as ordinary lint.

**An `unsafe` runtime rule does not fail the run.** It is withheld from
execution and reported, as today. Restore is what an `unsafe` runtime rule is
offered, and failing CI on it too would change runtime policy that this change
was not asked to change. The asymmetry is the server's table, deliberately: for
a static rule the signature only detects tampering, so failing is the one way
tampering has an effect; for a runtime rule the signature also authorizes
execution, so not running it already denies the edit its effect.

`unknown` static rules run with no notice, because every locally authored rule
is `unknown` and a notice per rule per run is noise that trains people to ignore
notices. `unknown` runtime rules keep today's skip reason.

### 5a. `--dangerously-run-scripts` means no checksums, for any engine

The flag skips reconcile entirely, logged in or not: nothing is signed, nothing is enforced,
every static rule runs and every runtime rule executes. It does only what it says, which is to
run things dangerously.

_Alternative:_ keep reconciling when logged in and let the flag override only the runtime
gate, so adding it to a CI command would not also disable sg and vale tamper detection.
Rejected (product decision, 2026-09-29): a flag with that name should not have a second,
partial meaning. The snapshot is still taken, so the run is still one code path.

### 6. Accounting is computed, not trusted

After parsing, every reported `ruleId` must appear in exactly one of `rules[]`,
`unknown[]`, or `entitlement.withheld[]`. A reported id in none is "not
accounted for" and fails the run naming the rule. An id in more than one is
treated the same way: the CLI does not guess which answer the server meant.
`missing` entries are not reported rules and are outside this check.

This is the check that would have caught #403's reuse hazard: a parser that
drops withheld entries produces unaccounted rules, and unaccounted rules fail.

### 7. `check` never writes to `.taskless/rules/`

The in-`check` repair is deleted. `unsafe` and `missing` produce a notice naming
`taskless rule restore <ruleId>`. The snapshot under `.taskless/.run/` is the only
thing `check` writes.

A lint that rewrites the tree it is linting cannot be reasoned about in CI or in
a hook, and would turn a Free plan's refusal into a message on every run.

### 8. Restore verifies against reconcile, not only against itself

`taskless rule restore <ruleId>` builds its expectation from a fresh reconcile
rather than from the restore response alone:

1. Snapshot and sign the local rule (if its directory exists), and reconcile
   the whole tree exactly as `check` would (Decision 3). Only this rule's
   verdict is used.
2. `run` or `withheld`: nothing to restore; say so and exit 0.
   `unknown`: not a rule of this repository; nothing to restore.
3. `unsafe`: the expected signature map is the local signatures, overridden by
   each file's `expected`, with every `got`-only path removed.
   `missing`: the expected revision is the verdict's `revisionId`.
4. Call restore. A refusal (`restoreRules: false`) prints `message` and exits
   non-zero with `RULE_RECOVERY_NOT_IN_PLAN`.
5. The served set must satisfy both: every file's `canonicalHash` equals its
   entry in the served `signatures`, and the signature map equals the expected
   map (for `unsafe`) or the served `revisionId` equals the expected one (for
   `missing`). Anything else is refused, and nothing is written.
6. Replace the rule directory with the served set (Decision 10).

Step 5's second half is what stops "newest issue wins" from quietly upgrading a
rule: restore repairs, it never advances.

`rule rollback <ruleId> <revisionId>` has no reconcile expectation to check
against. It requires that the served `revisionId` equal the requested one and
that every file match its served signature.

### 9. A refusal is an answer, printed with care

Restore, rollback, and a non-head fetch may answer `200` with
`{ restoreRules: false, reason, message, upgradeUrl }`. The CLI discriminates on
`restoreRules === false` (and, for fetch, on the absence of `rules`), prints
`message`, then `upgradeUrl` when it parses as an absolute `https:` URL.
`message` is server-authored text printed to a terminal, so C0/C1 control
characters other than newline are stripped first. An unrecognized `reason` is
still printed as a refusal, never reported as a service failure.

### 10. A delivered rule replaces its directory, after its signatures check

Every file set the CLI writes (create, improve, restore, rollback) is first
checked: each file's `canonicalHash` must equal its entry in `signatures`, every
signature must name a delivered file, and every delivered file outside `.tests/`
must have a signature. Then the rule directory is replaced, reusing
`writeDeliveredFileSet`'s purge-then-write path (`PurgeIncompleteError`
reporting included), so a stale local file cannot survive and make the rule
`unsafe` on the next run.

**Fixtures ship with every served set** (confirmed with the rules team,
2026-09-29), so the replace covers `.tests/` like everything else, and each file's
parent directories are created as it is written.

For create and improve the CLI also checks that the fetched `revisionId` equals
the one the request produced. The head is fetched without `revision=`, so a
Free organization is never refused for a just-generated rule.

### 11. The published `--json` shapes

- `rule create --json`: `{ success, requestId, rules: string[], files, notices? }`.
  `ruleId` is removed. It always held the request id; a field named `ruleId`
  that holds something other than a rule id is exactly the defect TSKL-307
  traced, and keeping it would re-teach agents to pass it to `rule improve`.
- `rule improve --json`: unchanged shape. Its input `ruleId` is now the rule's
  directory name.
- `check --json` gains an optional `integrity` array of
  `{ ruleId, engine?, verdict, files?, revisionId? }` for every non-`run`
  outcome except static `unknown`, where `verdict` is one of `unsafe`,
  `missing`, `unknown`, `unaccounted`, or `duplicate`. `entitlement.withheld`
  keeps naming local rules, now resolved by rule id.
- `rule restore --json` / `rule rollback --json`:
  `{ success, ruleId, revisionId, files, notices? }` on success, the standard
  error envelope otherwise.

## Risks / Trade-offs

- **[Risk] Vale section globs might resolve relative to the config file.** The
  assembled config moves into the snapshot. → Measured identical before building
  (Decision 2), and a test pins it.
- **[Risk] 0.11.x stops working when the floor is set.** Remote generation fails
  and reconcile returns `400` once 0.12.0 ships. → Accepted server-side (#229);
  0.11.x degrades to "service unavailable" and skips runtime rules without
  failing. The changeset says how to upgrade.
- **[Risk] A nightly from an intermediate slice.** → The stack merges down; no
  slice reaches `main` alone (see the proposal's delivery shape).
- **[Trade-off] Tamper detection requires authentication.** Logged-out,
  `--anonymous`, and unreachable runs cannot tell an edited rule from an intact
  one, and still pass. That is the existing degrade contract and stays.
- **[Trade-off] Rules generated before v2 reconcile as `unknown`** and cannot be
  restored (no backfill). Static ones keep running; runtime ones need
  regenerating. Nobody uses remote generation yet.
- **[Risk] The snapshot costs a copy per `check`.** → Rule trees are small
  (kilobytes). Measured in the reconcile slice; revisit only if a real corpus
  says otherwise.

## Migration Plan

1. Land the stack on its bottom branch, merging down (see proposal).
2. Validate end to end from a nightly against production v2: generate → fetch →
   reconcile `run` → edit → `unsafe` → restore → `run`. Report the round trip to
   the cloud team, which is how they close TSKL-307.
3. Merge to `main`; release 0.12.0.
4. The cloud team sets `V2_CLI_FLOOR = 0.12.0` from the published release.

Rollback: before step 4, reverting the merge restores 0.11.x behavior, and v1 is
still served. After step 4 a revert would publish a v1 client the server refuses,
so the path forward is a fix, not a revert.

## Open Questions

- Whether the cloud team wants an `engine` echo on `unknown` entries. The CLI
  already knows each reported rule's engine from its path, so this does not
  change the design.
