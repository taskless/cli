# Tasks

Slices land in order, each merging forward to `main`. Every slice leaves `check`
green on its own; none depends on a later one to be correct.

## 1. Layout truth (slice 1)

- [x] 1.1 Resolve the engine in `deleteRuleFiles` instead of hardcoding `sg`, via `findRuleEngine` beside `ENGINE_LAYOUTS`
- [x] 1.2 Make the `delete` not-found message engine-agnostic
- [x] 1.3 Correct the seven stale `.taskless/<engine>/rules/` comments, leaving the two historical ones in the migrations
- [x] 1.4 Test deleting a rule filed under each engine, and an id no engine holds
- [ ] 1.5 Correct the same stale layout in `cli-runtime-rule-execution`'s spec text (delta written; lands with this change)

## 2. Publish the layout table (slice 2) — unblocks the generator

- [x] 2.1 Split `engines.ts`: pure data (`ENGINES`, `ENGINE_LAYOUTS`, `RULES_DIRECTORY`, `RULE_TESTS_DIRECTORY`) away from the helpers importing `node:fs/promises`
- [x] 2.2 Add the `@taskless/cli/layout` export to `package.json` and the build
- [x] 2.3 Extend the chunk-graph build plugin to cover the new entry, so a host-capability import fails the build
- [x] 2.4 Test that the built entry imports cleanly with no filesystem or command-tree reachability
- [ ] 2.5 Publish a nightly and send the generator the version and specifier (answers **N1**)

## 3. Loud diagnostics on the runtime path (slice 3)

- [x] 3.1 Share one `assessCaptureRule` between discovery and `verify` (replaces the planned diagnostic channel — see design D4)
- [x] 3.2 Report each of the five drops: unreadable directory, unparseable YAML, wrong `kind`, missing `language`/`name`, missing `id`
- [x] 3.3 Surface them through `verify`, matching the `match`-mode wording already shipped
- [x] 3.4 Read `metadata.taskless.version`, refusing what this build does not implement
- [ ] 3.6 Read `RUNTIME_CHECK_PROTOCOL_VERSION` — deferred to slice 5; nothing on disk declares it until the payload carries it
- [x] 3.5 Test that each drop is both refused and explained

## 4. One executable per runtime rule (slice 4)

- [ ] 4.1 Refuse a runtime rule directory containing any `.ts` other than `check.ts`
- [ ] 4.2 Test that a helper module beside `check.ts` is refused and the check is not invoked

## 5. The file-set writer (slice 5)

- [ ] 5.1 Accept `files: [{path, content}]` alongside the legacy `content`, mutually exclusive
- [ ] 5.2 Validate the set against `ENGINE_LAYOUTS`, refusing an incomplete rule by name
- [ ] 5.3 Reject absolute paths, `..` segments, and anything outside the engine layout **before** any write
- [ ] 5.4 Write the rule directory atomically, so a refused set leaves nothing behind
- [ ] 5.5 Test delivery for all three engines, including a Vale rule with its `.vale.ini`
- [ ] 5.6 Test that a traversing path creates no file or directory
- [ ] 5.7 Test that delivery into the pre-`0004` location still lands correctly after migrations run
- [ ] 5.8 Regenerate `src/generated/api.d.ts` once their file-set tier is live
- [ ] 5.9 Tell the generator the release that ships this (answers **N2**) — only once it is on `main`

## 6. Re-fetch a withheld rule (slice 6)

- [ ] 6.1 Agree the request shape with the generator (answers **N3**): rule id plus signature, scoped like reconcile
- [ ] 6.2 Re-fetch on `unsafe` / `unknown` instead of only warning
- [ ] 6.3 Verify the returned bytes against the held signature before writing
- [ ] 6.4 Test that a tampered check is repaired, and that re-fetch never returns newer bytes

## 7. Close out

- [ ] 7.1 Reply to **N4**: leave the `engine` tier defined and unused — G2 means no engine but `sg` is deliverable as a single file, so the middle rung has no future occupant either
- [ ] 7.2 Grow the changeset as each slice lands; it stays on the bottom branch
- [ ] 7.3 Archive the change on the final slice
