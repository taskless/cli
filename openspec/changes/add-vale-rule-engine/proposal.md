## Why

Taskless rules are ast-grep only — structural AST matching that fits code but cannot lint prose. A large, wanted class of rules (terminology, banned and weasel words, inclusive language, readability, heading and style consistency) targets Markdown and prose, which ast-grep structurally cannot express: its text nodes are opaque, and it has no dictionaries, no NLP, and no code-vs-prose scoping. Vale is a mature, markup-aware prose linter that covers exactly that gap.

`partition-rules-by-engine` builds the layout this plugs into — `.taskless/<engine>/` with directory-based dispatch and a scaffolded but inert `vale/`. This change makes that directory execute, and adds the knowledge an agent needs to decide when a rule belongs there at all.

## What Changes

- Add Vale as a second **static-tier** engine: resolve its binary, run `vale --config .taskless/vale/.vale.ini --output=JSON --no-exit` over the target paths, and map findings into the scanner-agnostic `CheckResult` (stripping the `rules.` check-name prefix, normalizing severities).
- Express per-rule scoping through `.vale.ini` **matchers** (`[<glob>] rules.<name> = YES/NO`; enables union across matchers, disable wins, order-independent), with Taskless breadcrumbs carried as `tskl)`-namespaced keys Vale accepts and silently ignores.
- Verify Vale rules against per-rule `pass/`/`fail/` fixture directories, generating an isolating `.vale.ini` at verify time rather than committing one.
- Run engines concurrently and merge their results into one set, with an unavailable engine reported rather than aborting the others.
- Add an **engine-selection** knowledge topic — which engine (`sg` / `vale` / `runtime`) can enforce a requested rule — kept distinct from `route`'s authoring destination and from trust tier.

## Capabilities

### New Capabilities

- `cli-vale-rule-engine`: Vale as a concrete static engine — static-tier trust (its Tengo `script` sandbox exposes only `text`/`math`/`fmt`), the `.vale.ini` matcher scoping model, the `--config` check runner bounded by a subprocess timeout, fixture-based verify, and findings → `CheckResult` mapping.

### Modified Capabilities

- `cli-rule-format`: Vale's layout maps to `StylesPath` via the `rules/` StyleName — the directory `partition-rules-by-engine` scaffolds becomes the style Vale actually loads.
- `cli-check`: Engines run concurrently and their results merge into one set; an unavailable engine is reported without aborting the rest.
- `cli-rule-routing`: Gains an engine-selection topic, as an axis distinct from authoring destination and from trust tier. Ambiguity defaults to an engine known to be available.
- `cli-help`: The engine-selection topic is registered in the help index, and `route`/`static` cross-reference it so the local flow applies the same engine test the service does.

## Impact

- **CLI (`packages/cli`)**: new `rules/vale/*` (binary resolution, runner, `CheckResult` mapping, fixture verify); `commands/check.ts` (concurrent multi-engine execution and merge); new `src/help/<engine-selection>.txt` plus help-index registration and `route`/`static` cross-references.
- **Prerequisites**: `partition-rules-by-engine` must land first — this executes a directory that change creates. `add-vale-binary-packages` must land first as well, or there is no binary to resolve.
- **New external dependency**: the Vale binary, delivered as per-platform packages rather than assumed on `PATH`.
- **Deliberately excluded**: generating Vale rules and authoring the committed `.vale.ini`. That is rule-generation work, split between a CLI-side authoring change and server-side generation in the platform repo.

## Delivery shape

**Stacked, merging down.** The Vale engine is only correct once `check` can dispatch to it: the runner without the multi-engine orchestration ships an engine that never executes, and the orchestration without the runner dispatches to nothing.

| Unit | Scope                                                      |
| ---- | ---------------------------------------------------------- |
| 1    | Binary resolution, Vale runner, `CheckResult` mapping      |
| 2    | Fixture-based verify                                       |
| 3    | Concurrent multi-engine orchestration and merge            |
| 4    | Engine-selection knowledge topic and its help registration |

Unit 4 is the arguable exception — a knowledge topic is inert and would be safe alone — but it describes `vale` as an engine an agent can choose, which is only true once units 1–3 exist. It rides the same stack rather than shipping guidance ahead of the capability.
**Tracking:** OSS-21
