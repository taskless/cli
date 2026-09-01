# Tasks

One PR. The command and the recipe that names it are the same seam this change
exists to remove, so they land together.

## 0. Blocked on the service half

- [ ] 0.1 Confirm the endpoint shapes with the generator team (**N9**): `POST /cli/api/demo/rule` returning `{ ruleId, status }`, `GET /cli/api/demo/rule/{ruleId}` returning `{ ruleId, status, rules[] }` with the published file-set variant
- [ ] 0.2 Confirm the demo is servable unauthenticated, and get their answer on whether reconcile can bless the sample signature for an anonymous caller (design D3). A "no" is a complete answer and changes nothing below
- [ ] 0.3 Agree what the demo rule is for — the scenario the generated rule addresses — so the demo shows something a person recognises rather than an arbitrary rule

**Nothing below starts until 0.1 lands.** Building against a guessed shape is
what produced the seam this change is closing.

## 1. The client path

- [ ] 1.1 Add the demo endpoints to `src/api/`, reusing the existing client rather than a second fetch layer
- [ ] 1.2 Drive them through `submitRule`/`pollRuleStatus`, so polling and the terminal `failed`/`unsupported` states are the same code an ordinary generation uses
- [ ] 1.3 Write through `writeRuleFile`. If the demo needs its own writer, stop: the shapes have diverged and that is the finding
- [ ] 1.4 Report a terminal status by surfacing the service's reason, which `unsupportedMessage` already prefers over our own text
- [ ] 1.5 Regenerate `src/generated/api.d.ts` once the endpoints are published

## 2. The hidden topic

- [ ] 2.1 Add `src/agent/__undocumented-sample-runtime.txt`, absent from `RECIPE_TOPICS`
- [ ] 2.2 The recipe names the command, says the rule may be imperfect, and says how to delete it
- [ ] 2.3 The recipe states where the demo stops and why, so a reader meets the signature gate as a design rather than as a failure
- [ ] 2.4 Test that the topic is fetchable by name and absent from the index

## 3. Prove it does not weaken the gate

- [ ] 3.1 Test that an unauthenticated `check` skips a demo rule, with the reason it already gives
- [ ] 3.2 Test that the demo rule executes under `--dangerously-run-scripts` and under nothing else
- [ ] 3.3 Test that no demo rule identifier is special-cased anywhere on the execution path

## 4. Prove it does not write a broken rule

- [ ] 4.1 Test that a delivered demo rule missing `check.ts` or its captures is refused and nothing is written
- [ ] 4.2 Test that a terminal `unsupported` surfaces the service's reason and writes nothing
- [ ] 4.3 Test the whole path against a mock serving both endpoints, asserting the rule lands and `verify` reports it valid

## 5. Prove it can be undone

- [ ] 5.1 Test that deleting the demo rule by id removes its directory and that a later `check` does not report it

## 6. Close out

- [ ] 6.1 Tell the generator team the release that ships this
- [ ] 6.2 Archive the change
