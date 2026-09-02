# Tasks

One PR. The command and the recipe that names it are the same seam this change
exists to remove, so they land together.

## 0. Blocked on the rename, then on the service half

The generator team renamed the request resource first, as its own change:
`request`/`requestId` rather than `rule`/`ruleId`. Their own
`openspec/specs/cli/spec.md` already specified it, and their live `meta` block
already carries `ticketId` per delivered rule, so the route was the outlier.

- [x] 0.0 Wait for the rename to land and the new schema to publish. **Done**: verified from `GET /cli/api/__schema` that `/cli/api/request/*` is canonical and the `rule/*` family is `deprecated: true` while still serving. Adopting it in our client was its own change, tracked separately, and it has since landed
- [x] 0.0a The demo therefore takes the settled noun: `POST /cli/api/demo/request` and `GET /cli/api/demo/request/{requestId}`

The demo did not start before that, which was the point. Naming these endpoints
earlier would have made the demo the place a new convention debuted, which is
what design D2 rules out. The mainline took the noun first; the demo follows it.

## 0b. Blocked on the service half

- [x] 0.1 Confirm the endpoint shapes with the generator team (**N9**): `POST /cli/api/demo/request` returning `{ requestId, status }`, `GET /cli/api/demo/request/{requestId}` returning `{ requestId, status, rules[] }` with the published file-set variant. Agreed both sides
- [x] 0.2 Confirm the service can serve the demo endpoints unauthenticated, and get their answer on whether reconcile can bless the sample signature for an anonymous caller. **Answered, both halves.** The endpoints take no authentication at all — public, like `rule-hash-vectors` — because nothing in the demo is scoped to a caller: no ticket, no corpus entry, no bill, and one Taskless-owned installation behind every request. And no blessing, for the reason D3 now records: blessing is recording, and a shared fixed rule is never recorded for the caller, so authenticating would not reach execution either
- [ ] 0.3 Agree what the demo rule is for — the scenario the generated rule addresses — so the demo shows something a person recognises rather than an arbitrary rule
- [x] 0.4 Tell the service the findings shape we want. **Void, not done**: the service withdrew the findings entirely (D6). The verification gate already refuses a rule whose asymmetry does not hold, so findings alongside the rule are a constant implied by delivery. There is no shape to agree
- [ ] 0.5 Ask the service which status `iterate` returns for a request outside the caller's organization: 404 `request_not_found` or 403 `access_denied`. It decides what `rule improve` against the demo rule reports — `iterateRule` maps the 404 to a `CLIError` carrying `RULE_NOT_FOUND` and the 403 to a plain `Error`, which `improveCommand` reports as `NETWORK_ERROR`, telling an agent to retry an id that will never resolve. The demo request exists under a Taskless-owned installation and is not the caller's, which is 403-shaped. D7 and the spec state the behaviour rather than a code until this is answered

**Nothing below starts until 0.0 and 0.1 land.** Building against a guessed shape is
what produced the seam this change is closing.

## 1. The client path

- [ ] 1.1 Add the demo endpoints to `src/api/`, reusing the existing client rather than a second fetch layer
- [ ] 1.2 Drive them through `submitRule`/`pollRuleStatus`, so polling and the terminal `failed`/`unsupported` states are the same code an ordinary generation uses
- [ ] 1.2a Make that reuse possible first: `submitRule` and `pollRuleStatus` hardcode their endpoint as a literal (now `/cli/api/request` and `/cli/api/request/{requestId}`, since the client adopted the rename) and take a required `token` that `createApiClient` turns into an `Authorization` header unconditionally. Parameterize the endpoint and make the token optional. **Not a divergence signal** — see D1; these were written when every caller was authenticated, and the demo is the first that is not
- [ ] 1.2b Confirm an unauthenticated call sends no `Authorization` header at all, rather than one with an empty token. A header the service must then decide how to ignore is a worse contract than its absence
- [ ] 1.3 Write through `writeRuleFile`. If the demo needs its own writer, stop: the shapes have diverged and that is the finding
- [ ] 1.4 Report a terminal status by surfacing the service's reason, which `unsupportedMessage` already prefers over our own text
- [ ] 1.5 Regenerate `src/generated/api.d.ts` once the endpoints are published
- [ ] 1.6 Point the reader at running the rule, since that is the whole demonstration once nothing is served beside it. `taskless test` reporting a runtime rule as passing when its fixtures never ran turns the demonstration into a claim, so this task is blocked on that being fixed

## 2. The hidden topic

- [ ] 2.0 Register the command as `rule demo` under the existing `rule` command in `src/commands/rules.ts`. Not a top-level verb: `SUBCOMMAND_NAMES` and `subCommands` are unchanged, so the `agent` index's command listing gains nothing (design D4a)
- [ ] 2.1 Add `src/agent/__undocumented-sample-runtime.txt`, absent from `RECIPE_TOPICS`
- [ ] 2.2 The recipe names the command, says the rule may be imperfect, and says how to delete it
- [ ] 2.3 The recipe states where the demo stops and why, so a reader meets the signature gate as a design rather than as a failure
- [ ] 2.4 Test that the topic is fetchable by name and absent from the index
- [ ] 2.5 Test that the `agent` index's command listing is unchanged by the demo, so the second listing is covered and not just `RECIPE_TOPICS`

## 3. Prove it does not weaken the gate

- [ ] 3.1 Test that an unauthenticated `check` skips a demo rule, with the reason it already gives
- [ ] 3.2 Test that the demo rule executes under `--dangerously-run-scripts` and under nothing else
- [ ] 3.3 Test that no demo rule identifier is special-cased anywhere on the execution path
- [ ] 3.4 Test that `rule improve` against the demo rule terminates without writing anything, and reports a terminal failure rather than one that invites retrying the same id. Pin the behaviour so it cannot regress into a partial improve flow (D7). Pin the specific code once 0.5 answers which status the service sends; asserting one before that would encode a guess

## 4. Prove it does not write a broken rule

- [ ] 4.1 Test that a delivered demo rule missing `check.ts` or its captures is refused and nothing is written
- [ ] 4.2 Test that a terminal `unsupported` surfaces the service's reason and writes nothing
- [ ] 4.3 Test the whole path against a mock serving both endpoints, asserting the rule lands and `verify` reports it valid
- [ ] 4.4 Test that the retrieval response is consumed as an ordinary delivery, with no demo-only field read from it and none required to be present

## 5. Prove it can be undone

- [ ] 5.1 Test that deleting the demo rule by id removes its directory and that a later `check` does not report it
- [ ] 5.2 Test that an ordinary `check` skips the demo rule through the existing unverified-runtime path, asserting the reason comes from that path rather than from anything the demo added (D7)

## 6. Close out

- [ ] 6.1 Tell the generator team the release that ships this
- [ ] 6.2 Archive the change
