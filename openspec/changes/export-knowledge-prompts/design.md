## Context

The CLI's knowledge prompts live at `packages/cli/src/help/*.txt` — canonical `<topic>.txt` recipes (`route`, `static`, `remote`, `existing`, `detect`, `rule-meta`, `check`, `rule-create`, …) plus `<topic>.anonymous.txt` local-only variants. `commands/help.ts` embeds them at build time with `import.meta.glob("../help/*.txt", { query: "?raw", import: "default", eager: true })`, builds `helpMap`/`anonymousMap`, and — for some topics — interpolates `%(KEY)s` placeholders (e.g. `CLI_VERSION`, `INPUT_SCHEMA`, agent-fill markers) via `sprintf-js` at render time.

The package ships only `dist` and exports only `"." → ./dist/index.js` (which pulls the whole command tree: `citty`, `zod`, telemetry, …). So the prompts are reachable only by running `taskless help <topic>` — not importable. `workers/generator` (a Cloudflare Worker) needs the same guidance programmatically, and must be able to import it **without** dragging in the CLI runtime.

## Goals / Non-Goals

**Goals:** expose the knowledge prompts as a stable, typed, importable API (`@taskless/cli/prompts`); keep one source of truth shared with the `help` command — the same embedded text _and_ the same render pipeline, so both surfaces emit identical output; keep the import free of the CLI runtime so a Worker can consume it.

**Non-Goals:** exposing a caller-facing template/render API (`renderPrompt(topic, vars)`); changing the `help` command's observable behavior or the recipe text; changing rule execution or on-disk formats.

## Decisions

### D1 — A shared prompts module is the single source; `help.ts` consumes it

Move the glob + `buildHelpMaps` logic **and `renderRecipe`** (`commands/help.ts:83-95`) into `src/prompts/recipes.ts`; `help.ts` imports from it. One embed and one render path, no duplication. `src/prompts/index.ts` sits on top of that module as the public entry, so the shared implementation and the published surface are separately reviewable.

- **Alternative — a second glob in `help.ts` and the export:** rejected; two embeds drift.
- **Alternative — share the embed but not the renderer:** rejected; the two surfaces would emit different text from identical source, which is the drift the change exists to prevent.

### D2 — The export carries no CLI runtime, imported via a subpath

The `src/prompts/` graph (`index.ts` and the `recipes.ts` it consumes) imports nothing from the CLI runtime — no `citty`/command tree, no telemetry, no filesystem or network. It may import `sprintf-js` and the two Zod input schemas (`schemas/rules-create`, `schemas/rules-improve`), which are leaf modules whose only dependency is `zod`; both are already dependencies of the intended consumer. The subpath export `@taskless/cli/prompts` maps to a dedicated `dist/prompts.js` so importing it never loads `dist/index.js`.

- **Alternative — re-export from the main entry (`@taskless/cli`):** rejected; the main entry pulls the whole CLI, unusable/heavy in a Worker.
- **Alternative — pure data with zero deps, pre-rendering `INPUT_SCHEMA` at build time:** rejected as premature; it buys nothing for the intended consumer (which already ships `zod`) and adds a codegen step to keep in sync.

### D3 — Prompts are functions returning fully-rendered text

Each prompt is a function; calling it runs the same pipeline `taskless help` runs — `applyCliInvocation`, then `sprintf` over the variable table — and returns finished text. A consumer never observes a `%(KEY)s` placeholder.

Every placeholder in use today is resolvable **inside** the package, so there is nothing for a caller to supply:

| Placeholder           | Topics                        | Resolved from                                                   |
| --------------------- | ----------------------------- | --------------------------------------------------------------- |
| `CLI_VERSION`         | all (header line)             | build define `__VERSION__`                                      |
| `INPUT_SCHEMA`        | `rule-create`, `rule-improve` | `z.toJSONSchema()` over the Zod input schema                    |
| `PACKAGE_MANAGER_DLX` | `ci`                          | agent-fill marker `<package-manager-dlx>` (overridable, see D4) |

No topic the first consumer needs contains anything but `CLI_VERSION`. (An earlier draft of this design named a six-topic consumer set read off the `generator-decision-router` design; the `cloud` side has since established that only `static` is reachable server-side — see D6.)

Rendering also carries `applyCliInvocation` (`util/invocation.ts:18`), which rewrites `npx @taskless/cli` to the build-target invocation. That is a no-op for prod builds, and the first consumer will consume a normal published release (D6), so this is not load-bearing for that consumer. It still matters for parity in general: any consumer resolving the package from a non-prod build gets the same invocation string `taskless help` prints, because both go through one render path.

- **Alternative — return raw text, placeholders intact:** rejected; pushes an undocumented template dialect (sprintf-js, including its `%%` escaping rule) onto every consumer to solve values the package already knows.
- **Alternative — a caller-facing `renderPrompt(topic, vars)`:** rejected as speculative; there is no variable a caller knows and the package does not. The optional-options escape hatch in D4 covers the case non-breakingly if one appears.

### D4 — Typed accessor: `PromptTopic`, `PROMPTS`, `getPrompt`

Expose a `PromptTopic` string-union of canonical topics, a `PROMPTS: Record<PromptTopic, (options?: PromptOptions) => string>` map of render functions, and a `getPrompt(topic, options?)` accessor over the same. Adding a future option is additive, not breaking.

`PromptOptions`:

| Field                | Default                 | Purpose                                                                     |
| -------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `anonymous?`         | `false`                 | select the `.anonymous` variant, falling back to canonical when none exists |
| `packageManagerDlx?` | `<package-manager-dlx>` | the one value a caller may know better than the package                     |
| `header?`            | `true`                  | include the `# Topic: <name> (CLI v<version> / topic v1)` first line        |

`header: false` exists for a concrete reason: the header embeds the CLI version, and a consumer placing rendered text in an LLM **system prompt** puts that version into the prompt-cache key — so every CLI publish invalidates the consumer's cache for every request, over a line the model does not use. Defaulting to `true` leaves `taskless help` output and every existing behavior byte-identical.

- **Alternative — let consumers strip the header themselves:** rejected; every consumer reimplements the same fragile first-line regex against text whose format we control, and it silently breaks if the header ever gains a line.

Topic names, the accessor shape, and `PromptOptions`' existing fields are the **public API** (semver-tracked); recipe _text_ may change within a major.

- **Alternative — `Record<PromptTopic, string>` of pre-rendered strings:** rejected; it has no room for the `anonymous` dimension without doubling the key space, and forecloses per-call options.

### D5 — `PromptTopic` is an explicit list, kept honest by a completeness check

`PromptTopic` derives from a hand-maintained `const TOPICS = [...] as const` tuple, not from the recipe files on disk. A companion `INTERNAL_TOPICS` set records recipe files deliberately withheld from the export. A test asserts the canonical `help/*.txt` topics on disk equal `TOPICS ∪ INTERNAL_TOPICS`, failing in either direction.

Deriving the union from the glob is not possible at the type level regardless: Vite types `import.meta.glob` as `Record<string, M>` (`vite/types/importGlob.d.ts:69-70,88`) — the keys are `string`, with no literal inference from the pattern.

It is also not desirable. Topic names are semver-tracked public API (D4), so an auto-derived union would let a new `src/help/*.txt` file silently publish public API, and a deleted one silently ship a major break. The explicit list is the gate; the check is what prevents the gate from drifting out of sync unnoticed. A new recipe file fails CI on the PR that adds it, forcing a deliberate export-or-withhold decision.

- **Alternative — codegen `topics.generated.ts` from the glob with a CI `--check` mode:** rejected; converts the failure from a red test to a red type error, but adds a generated file plus a script, still needs the same CI gate, and reinstates silent publishing of any newly added recipe.
- **Trade-off accepted:** completeness is enforced at test time, not compile time. The check runs on the PR that introduces the divergence, which is when it matters.

### D6 — The initial exported topic list is minimal, driven by a real consumer

The first consumer (`generator-decision-router`, in the `cloud` repo) has confirmed which topics it can actually use server-side, and it is not the set this design originally assumed. Verified against the recipe files:

| Topic       | Server-side usable | Why not                                                                                                                                                                      |
| ----------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static`    | **yes**            | canonical on-disk rule shape; the one topic the router wants                                                                                                                 |
| `route`     | no                 | picks an _authoring destination_ (`existing`/`static`/`remote`) pre-service; runs `detect`, asks the user. A request reaching the generator has already resolved to `remote` |
| `remote`    | no                 | states the boundary itself — "The service owns rule-type selection" (`remote.txt:51`)                                                                                        |
| `detect`    | no                 | documents a CLI subprocess a Worker cannot run                                                                                                                               |
| `existing`  | no                 | local-toolchain authoring; structurally unreachable server-side                                                                                                              |
| `rule-meta` | no                 | unrelated — reads a `rule improve` metadata sidecar                                                                                                                          |

So `TOPICS` starts at the minimum a consumer genuinely needs and grows on demand. Under D4 an exported name is a promise held for a major version; exporting a topic speculatively spends that promise for nothing. Everything else is recorded in `INTERNAL_TOPICS` (D5), which keeps them visible and deliberate rather than forgotten.

Consumption is via a **normal published release** of `@taskless/cli`. A workspace/path dependency is not an option — `../skills` sits outside the `cloud` pnpm workspace and does not resolve in its CI or the generator's Docker build — and the consumer has explicitly declined a prerelease, preferring to wait for a stable version rather than pin a moving one against an API that is by definition not yet semver-stable.

**This change is therefore not on anyone's critical path.** Nothing downstream is waiting on it, so it can be released at whatever cadence suits this repo, and there is no reason to cut a prerelease to unblock a consumer.

## Risks / Trade-offs

- **Build must emit the second entry** → configure Vite for a `prompts` entry with types; a CI/test asserts `dist/prompts.js` + `.d.ts` exist, or the export resolves to nothing at publish.
- **Build defines must reach the second entry** → `dist/prompts.js` depends on `__VERSION__` and `__TASKLESS_CLI__` being inlined. If the `prompts` entry is configured without the same `define` block as the main entry, rendering emits a literal `__VERSION__` or throws. A test asserting rendered output contains no `__`-prefixed define names covers this.
- **No per-topic tree-shaking** → a render function isn't statically analyzable, so all 20 recipes (~66 KB of text) ship even when a consumer reads six. Negligible against Worker bundle limits; accepted deliberately in exchange for `help`/export parity.
- **Prompt text drift within a major** → acceptable and stated; only topic names + accessor shape are stability-guaranteed.

## Migration Plan

Purely additive: add the module, the subpath export, and the build entry; move the embed + `renderRecipe` out of `help.ts` and import them back (no observable behavior change). No consumer migration needed until `generator-decision-router` imports it.

## Resolved Questions

- **Interpolation (resolved: no caller-facing renderer).** Prompts are functions that return fully-rendered text; every placeholder in use resolves inside the package (D3). `PromptOptions.packageManagerDlx` is the sole caller-supplied value, and none of the first consumer's topics use it.
- **Subpath name (resolved: `@taskless/cli/prompts`).** Confirmed as the published name. It reads accurately for a surface broader than routing — it covers every `help` recipe, including `ci`, `auth`, and `init` — and matches the name the `generator-decision-router` change already references.
