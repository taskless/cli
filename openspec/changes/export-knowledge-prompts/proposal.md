## Why

The CLI's **knowledge prompts** — `help/*.txt` (`route`, `static`, `remote`, `existing`, `detect`, `rule-meta`, `check`, …) — encode Taskless's rule-authoring and routing guidance. Today they are embedded at build time (Vite `import.meta.glob`) and reachable only through the `help` command (`npx @taskless/cli help <topic>`); the package `exports` is just `"." → dist/index.js`, so nothing can import them. `workers/generator` (and future consumers) need the _same_ guidance programmatically to give a consistent authoring/routing experience across the CLI and the service. This change exposes the prompts as a stable package import.

## What Changes

- Add a package **subpath export** `@taskless/cli/prompts` (built into `dist`, listed in `files`) that exposes the embedded `help/*.txt` recipes as importable, topic-keyed render functions.
- Provide a typed accessor (`getPrompt(topic, options?)` and a `PROMPTS` record of functions) plus a stable `PromptTopic` union so consumers get compile-time safety over available topics.
- Return **fully-rendered** text: calling a prompt resolves every `%(KEY)s` placeholder from values the package already holds (version, input schemas, agent-fill markers), so consumers never handle a template dialect.
- Keep the `help` command's output unchanged — it consumes the same embedded source _and_ the same renderer, so there is one source of truth for both surfaces.
- Treat the prompt export as **public API**: topic names and the accessor shape are semver-tracked; prompt _text_ may evolve within a major. Membership is an explicit list, not whatever files happen to be on disk, guarded by a completeness check so a new or deleted recipe can't silently change the published surface.

## Capabilities

### New Capabilities

- `cli-knowledge-prompts`: A stable, importable API exposing the CLI's knowledge prompts (the `help/*.txt` recipes) as topic-keyed render functions with a typed accessor, sourced from the same embedded content and render path the `help` command serves.

## Impact

- **`packages/cli`**: `package.json` `exports` (add `./prompts`) and `files`; a new `src/prompts/index.ts` holding the embedded `help/*.txt` map, the render path, and a typed accessor; `commands/help.ts` refactored to consume that shared module (no observable behavior change); the Vite build gains a second entry.
- **Consumers**: `@taskless/cli/prompts` becomes importable — the enabler for the `taskless/taskless` `generator-decision-router` change.
- **No change** to CLI commands, rule execution, or on-disk formats.

**Tracking:** OSS-20
