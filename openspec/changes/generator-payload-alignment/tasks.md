# Tasks

Slices land in order, each merging forward to `main`. Every slice leaves `check`
green on its own; none depends on a later one to be correct.

## 1. Layout truth (slice 1)

- [x] 1.1 Resolve the engine in `deleteRuleFiles` instead of hardcoding `sg`, via `findRuleEngine` beside `ENGINE_LAYOUTS`
- [x] 1.2 Make the `delete` not-found message engine-agnostic
- [x] 1.3 Correct the seven stale `.taskless/<engine>/rules/` comments, leaving the two historical ones in the migrations
- [x] 1.4 Test deleting a rule filed under each engine, and an id no engine holds
- [x] 1.5 Correct the same stale layout in `cli-runtime-rule-execution`'s spec text (delta written; lands with this change)

## 2. Publish the layout table (slice 2) — unblocks the generator

- [x] 2.1 Split `engines.ts`: pure data (`ENGINES`, `ENGINE_LAYOUTS`, `RULES_DIRECTORY`, `RULE_TESTS_DIRECTORY`) away from the helpers importing `node:fs/promises`
- [x] 2.2 Add the `@taskless/cli/layout` export to `package.json` and the build
- [x] 2.3 Extend the chunk-graph build plugin to cover the new entry, so a host-capability import fails the build
- [x] 2.4 Test that the built entry imports cleanly with no filesystem or command-tree reachability
- [x] 2.5 Publish a nightly and send the generator the version and specifier (answers **N1**)

## 3. Loud diagnostics on the runtime path (slice 3)

- [x] 3.1 Share one `assessCaptureRule` between discovery and `verify` (replaces the planned diagnostic channel — see design D4)
- [x] 3.2 Report each of the five drops: unreadable directory, unparseable YAML, wrong `kind`, missing `language`/`name`, missing `id`
- [x] 3.3 Surface them through `verify`, matching the `match`-mode wording already shipped
- [x] 3.4 Read `metadata.taskless.version`, refusing what this build does not implement
- [x] 3.6 Read `RUNTIME_CHECK_PROTOCOL_VERSION` — deferred to slice 5; nothing on disk declares it until the payload carries it
- [x] 3.5 Test that each drop is both refused and explained

## 4. One executable per runtime rule (slice 4)

- [x] 4.1 Refuse a runtime rule directory containing any `.ts` other than `check.ts`
- [x] 4.2 Test that a helper module beside `check.ts` is refused and the check is not invoked

## 5. The file-set writer (slice 5)

- [x] 5.1 Accept `files: [{path, content}]` alongside the legacy `content`, mutually exclusive
- [x] 5.2 Validate the set against `ENGINE_LAYOUTS`, refusing an incomplete rule by name
- [x] 5.3 Reject absolute paths, `..` segments, and anything outside the engine layout **before** any write
- [x] 5.4 Write the rule directory atomically, so a refused set leaves nothing behind
- [x] 5.5 Test delivery for all three engines, including a Vale rule with its `.vale.ini`
- [x] 5.6 Test that a traversing path creates no file or directory
- [x] 5.7 Covered already by `engine-dispatch.test.ts` — "keeps signatures identical and reports the moved path" proves the signature survives `0004`/`0005` while the reported path follows the move
- [x] 5.8 Regenerate `src/generated/api.d.ts` once their file-set tier is live — the union forced six call sites to narrow, and closed a payload that wrote the string `"undefined"` as a rule
- [x] 5.9 Tell the generator the release that ships this (answers **N2**) — only once it is on `main`

## 6. Re-fetch a withheld rule (slice 6)

- [x] 6.1 Agree the request shape with the generator (superseded by **N5**): `POST /cli/api/rule/{ruleId}/restore` with `{ repositoryUrl }`, which scopes the response to the owning org and install
- [x] 6.2 Re-fetch on `unsafe` / **`missing`** instead of only warning. **The task said `unknown` and that was wrong.** Read as a set, the entry shapes settle it: `unsafe` `{file, expected, got}` means the server holds bytes we drifted from, `missing` `{ruleId, file}` means it expected a rule we never reported, and `unknown` `{file}` means we hold a file it never issued — nothing to fetch, which is why that entry alone carries no rule id. `missing` was omitted despite being the only bucket already carrying the id restore is keyed on
- [x] 6.2a Explain `unknown` instead, since "on your disk, never issued by the service" is an ordinary situation (hand-written, or another org or install) that read as an unexplained skip
- [x] 6.3 Verify the returned bytes against the held signature before writing — against `unsafe.expected`, the signature reconcile ALREADY sent, not the one the restore response carries. Checking the response against itself proves only internal consistency, which a newer generation would also satisfy
- [x] 6.4 Test that a tampered check is repaired, and that re-fetch never returns newer bytes — the second is a real assertion rather than a relayed promise, because 6.3 verifies against `expected`

## 6b. What slice 6 does NOT do

- [x] 6.5 Nothing repaired runs in the pass that repaired it. Restore rewrites the working tree and promotes nothing into the current run: an `unsafe` rule stays withheld, a `missing` rule was never a local candidate, and an `unknown` rule never runs. Fetching code and executing it in the same pass that discovered the drift would move the gate
- [x] 6.6 A repair that fails is a notice, never a failed `check`. A rule that could not be repaired stays withheld, which is already the safe state
- [ ] 6.7 Ask the generator for `ruleId` on a reconcile `unsafe` entry (**N6**). Until then the id is parsed out of `.taskless/rules/runtime/<id>/check.ts`, which works and makes repair depend on a layout that has already moved twice — silently, since a wrong id is a 404 and an unrepaired rule rather than an error

## 7. Close out

- [ ] 7.1 Reply to **N4**: leave the `engine` tier defined and unused — G2 means no engine but `sg` is deliverable as a single file, so the middle rung has no future occupant either
- [ ] 7.2 Grow the changeset as each slice lands; it stays on the bottom branch
- [ ] 7.3 Archive the change on the final slice
