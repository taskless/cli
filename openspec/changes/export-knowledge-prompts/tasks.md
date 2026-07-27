## 1. Shared prompts module

- [ ] 1.1 Create `packages/cli/src/prompts/index.ts` that embeds `../help/*.txt` via the same `import.meta.glob(..., { query: "?raw", eager: true })` and builds canonical + anonymous maps
- [ ] 1.2 Export the typed API: `PromptTopic` union, `PROMPTS: Record<PromptTopic, string>`, `getPrompt(topic, opts?)` (with `{ anonymous?: boolean }` and canonical fallback), and `ANONYMOUS_PROMPTS`
- [ ] 1.3 Ensure the module imports nothing from the CLI runtime (no `citty`/telemetry/command tree) — data + types only
- [ ] 1.4 Refactor `commands/help.ts` to consume the shared module (remove its own glob/`buildHelpMaps`), leaving `help` behavior unchanged

## 2. Package export + build

- [ ] 2.1 Add the `./prompts` subpath to `package.json` `exports` (→ `./dist/prompts.js`, with `types`) and keep `files: ["dist"]`
- [ ] 2.2 Configure the Vite build to emit `dist/prompts.js` (+ `dist/prompts.d.ts`) as a second entry alongside `dist/index.js`
- [ ] 2.3 Add a build/CI assertion that `dist/prompts.js` and its types exist after `vite build`

## 3. Verify

- [ ] 3.1 Test: `getPrompt(topic)` parity with the `help` command's un-interpolated text; raw `%(KEY)s` placeholders preserved; anonymous variant retrieval + fallback; `PromptTopic` rejects unknown topics
- [ ] 3.2 Test/assert the prompts entry does not pull in the CLI runtime (import graph excludes `dist/index.js` deps)
- [ ] 3.3 `pnpm --filter @taskless/cli typecheck && lint && test` clean; `vite build` emits both entries
