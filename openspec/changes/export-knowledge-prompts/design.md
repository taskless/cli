## Context

The CLI's knowledge prompts live at `packages/cli/src/help/*.txt` — canonical `<topic>.txt` recipes (`route`, `static`, `remote`, `existing`, `detect`, `rule-meta`, `check`, `rule-create`, …) plus `<topic>.anonymous.txt` local-only variants. `commands/help.ts` embeds them at build time with `import.meta.glob("../help/*.txt", { query: "?raw", import: "default", eager: true })`, builds `helpMap`/`anonymousMap`, and — for some topics — interpolates `%(KEY)s` placeholders (e.g. `CLI_VERSION`, `INPUT_SCHEMA`, agent-fill markers) via `sprintf-js` at render time.

The package ships only `dist` and exports only `"." → ./dist/index.js` (which pulls the whole command tree: `citty`, `zod`, telemetry, …). So the prompts are reachable only by running `taskless help <topic>` — not importable. `workers/generator` (a Cloudflare Worker) needs the same guidance programmatically, and must be able to import it **without** dragging in the CLI runtime.

## Goals / Non-Goals

**Goals:** expose the knowledge prompts as a stable, typed, importable API (`@taskless/cli/prompts`); keep one source of truth shared with the `help` command; keep the import dependency-light so a Worker can consume it.

**Non-Goals:** rendering/interpolating `%(KEY)s` placeholders in the export (that needs CLI runtime context); changing the `help` command's behavior or the recipe text; changing rule execution or on-disk formats.

## Decisions

### D1 — A shared prompts module is the single source; `help.ts` consumes it

Move the glob + `buildHelpMaps` logic into `src/prompts/index.ts`; `help.ts` imports from it. One embed, no duplication.

- **Alternative — a second glob in `help.ts` and the export:** rejected; two embeds drift.

### D2 — The export is dependency-light (pure data + types), imported via a subpath

`src/prompts/index.ts` imports nothing from the CLI runtime (no `citty`/command tree/telemetry) — only the embedded strings and types. The subpath export `@taskless/cli/prompts` maps to a dedicated `dist/prompts.js` so importing it never loads `dist/index.js`.

- **Alternative — re-export from the main entry (`@taskless/cli`):** rejected; the main entry pulls the whole CLI, unusable/heavy in a Worker.

### D3 — The export returns RAW recipe text (placeholders intact)

Prompts are returned verbatim, including any `%(KEY)s` placeholders. Interpolation stays CLI-side because it needs runtime context (version, package manager, input schemas). Consumers that feed guidance to an LLM router use the raw text as-is; a shared renderer can be added later if a concrete need appears.

- **Alternative — export rendered text:** rejected; rendering requires CLI runtime state the export can't (and shouldn't) hold.

### D4 — Typed accessor: `PROMPTS`, `PromptTopic`, `getPrompt`

Expose a `PromptTopic` string-union of canonical topics, a `PROMPTS: Record<PromptTopic, string>` map, and `getPrompt(topic, opts?)`. Anonymous variants are accessible via `getPrompt(topic, { anonymous: true })` (falling back to canonical when no variant exists) and/or an `ANONYMOUS_PROMPTS` map. Topic names + accessor shape are the **public API** (semver-tracked); recipe _text_ may change within a major.

## Risks / Trade-offs

- **Build must emit the second entry** → configure Vite for a `prompts` entry with types; a CI/test asserts `dist/prompts.js` + `.d.ts` exist, or the export resolves to nothing at publish.
- **Raw placeholders surprise consumers** → document that text may contain `%(KEY)s`; optionally export the placeholder inventory later.
- **Prompt text drift within a major** → acceptable and stated; only topic names + shape are stability-guaranteed.

## Migration Plan

Purely additive: add the module, the subpath export, and the build entry; refactor `help.ts` internally (no behavior change). No consumer migration needed until `generator-decision-router` imports it.

## Open Questions

- Do consumers need `%(KEY)s` interpolation (a shared `renderPrompt`), or is raw sufficient for the generator's LLM-driven router? (Assumed raw is enough.)
- Final subpath name — `@taskless/cli/prompts` proposed; confirm before publishing since it's public API.
