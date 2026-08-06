## 1. Shared prompts module

- [x] 1.1 Create `packages/cli/src/prompts/recipes.ts` that embeds `../help/*.txt` via the same `import.meta.glob(..., { query: "?raw", eager: true })` and builds canonical + anonymous maps
- [x] 1.2 Move `renderRecipe` + the `TOPIC_INPUT_SCHEMAS` table out of `commands/help.ts` into the shared module, so interpolation lives on the shared path
- [ ] 1.3 Export the typed API from `packages/cli/src/prompts/index.ts`: `PromptTopic` union (from an explicit `const TOPICS = [...] as const`), `PromptOptions` (`anonymous?`, `packageManagerDlx?`, `header?`), `PROMPTS: Record<PromptTopic, (options?: PromptOptions) => string>` of render functions, and `getPrompt(topic, options?)` with canonical fallback for anonymous
- [ ] 1.4 Add an `INTERNAL_TOPICS` list recording recipe files deliberately withheld from the export; classify every existing `help/*.txt` as exported or internal. Per D6, `TOPICS` starts minimal — `static` is the only topic a consumer has asked for; `route`/`remote`/`detect`/`existing`/`rule-meta` are internal until one does
- [x] 1.5 Ensure the module imports nothing from the CLI runtime (no `citty`/telemetry/command tree/fs/network) — embedded text, types, `sprintf-js`, `applyCliInvocation`, and the leaf Zod input schemas only
- [x] 1.6 Refactor `commands/help.ts` to consume the shared module (remove its own glob/`buildHelpMaps`/`renderRecipe`), leaving `help` output byte-identical

## 2. Package export + build

- [x] 2.1 Add the `./prompts` subpath to `package.json` `exports` (→ `./dist/prompts.js`, with `types`) and keep `files: ["dist"]`
- [x] 2.2 Configure the Vite build to emit `dist/prompts.js` (+ `dist/prompts.d.ts`) as a second entry alongside `dist/index.js`, **with the same `define` block** (`__VERSION__`, `__TASKLESS_CLI__`) as the main entry
- [x] 2.3 Add a build/CI assertion that `dist/prompts.js` and its types exist after `vite build`

## 3. Verify

- [x] 3.1 Test: `getPrompt(topic)` parity with the `help` command's rendered text; every `%(KEY)s` resolved (no literal placeholder survives); `rule-create`/`rule-improve` render their JSON Schema; `ci` renders the `<package-manager-dlx>` default and honors an override; `header: false` drops the `# Topic:` line and leaves no version string while the body is unchanged; anonymous variant retrieval + fallback; `PromptTopic` rejects unknown topics
- [x] 3.2 Test: rendered output from the built `dist/prompts.js` contains no un-inlined build define (e.g. a literal `__VERSION__`)
- [x] 3.3 Test/assert the prompts entry does not pull in the CLI runtime (import graph excludes `dist/index.js` deps)
- [x] 3.4 Completeness check: assert the canonical `help/*.txt` topics on disk equal `TOPICS ∪ INTERNAL_TOPICS` — fails both when a new recipe is unclassified and when an exported topic's file is gone
- [x] 3.5 `pnpm --filter @taskless/cli typecheck && lint && test` clean; `vite build` emits both entries
