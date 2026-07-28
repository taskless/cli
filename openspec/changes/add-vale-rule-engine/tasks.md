## 0. Prerequisites

- [ ] 0.1 Confirm `partition-rules-by-engine` has landed: `.taskless/vale/` is scaffolded, dispatch routes by engine directory, and `check` runs ast-grep over the committed `sg/sgconfig.yml`. This change extends that layout; it does not create it
- [ ] 0.2 Confirm the Vale platform packages from `add-vale-binary-packages` are published and declared, so there is a binary to resolve

## 1. Vale engine

- [ ] 1.1 Extract the platform-binary resolution in `findSgBinary()` (`rules/scan.ts:38-61`) into a shared helper — resolve `<pkg>/package.json` via `createRequire(import.meta.url)`, exec the binary beside it, fall back to `PATH` — and use it for both `sg` and `vale`. When nothing resolves, report the Vale engine unavailable without aborting other engines (D6b)
- [ ] 1.1b Publish per-platform Vale binary packages under the Taskless scope: binary in the tarball, `os`/`cpu` declared, **no `bin`, no code, no scripts** (we exec by path, so nothing needs hardlinking into place). Add them to `packages/cli` as `optionalDependencies`. Include Vale's MIT attribution. Do NOT depend on a download-at-postinstall package: the script runs under the consumer's package-manager policy, and pnpm 10 blocks it by default, yielding no binary and no error
- [ ] 1.1c CI job to mirror upstream Vale releases into those packages; decide the architecture set (ast-grep's seven is the starting point) and pin the Vale version the CLI expects
- [ ] 1.1d Handle musl: `findSgBinary()` maps every Linux to `-gnu`, so Alpine falls through to `PATH` today. Detect libc for the Vale lookup (upstream ast-grep uses `detect-libc`) and decide whether to publish a musl variant or leave the `PATH` fallback deliberately
- [ ] 1.1e Confirm the Vite build externalizes the platform packages rather than bundling them, and that `createRequire(import.meta.url)` resolves correctly from `dist/` — the same context `findSgBinary()` already relies on
- [ ] 1.2 Add `rules/vale/run.ts`: run `vale --config .taskless/vale/.vale.ini --output=JSON --no-exit <paths>`, bounded by a subprocess timeout that terminates and reports on expiry
- [ ] 1.3 Map Vale JSON findings → `CheckResult`: `source: "vale"`, `ruleId` = check name with `rules.` stripped, severity `error/warning/suggestion → error/warning/hint`, and `message`/`note`/`range`/`matchedText`/`fix` per the mapping
- [ ] 1.4 Add `rules/vale/verify.ts`: for each `vale/rule-tests/<rule>/`, generate an ephemeral `.vale.ini` enabling only that rule, run Vale over `pass/`/`fail/` fixtures, assert every `fail/` yields a finding and every `pass/` none
- [ ] 1.5 Tests: `rules.` stripping + severity mapping; committed-config scoping respected (include union, exclude disable, duplicate matchers merge); verify pass/fail; missing-binary and timeout paths

## 2. Check orchestration

- [ ] 2.1 Dispatch to distinct executors by engine directory — ast-grep (`sg/`) → scanner, Vale (`vale/`) → runner, runtime (`runtime/rules/`) → harness
- [ ] 2.2 Run engines concurrently, merge `CheckResult`s into one set, derive the exit code from merged severities, and keep an unavailable engine from aborting the others
- [ ] 2.3 Tests: a mixed `sg`+`vale`+`runtime` corpus runs all executors and merges; with the `vale` binary absent, ast-grep results still return

## 3. Engine-selection knowledge topic

- [ ] 3.1 Author `packages/cli/src/help/<engine-selection>.txt` from the seed prose in `tmp/SEED-engine-selection-prose.md`: the three engine definitions (`sg` in-file syntax tree incl. relational correlation, `vale` prose/markup, `runtime` cross-file/graph/metadata/normalization), the reason-before-answer procedure, and the worked example table
- [ ] 3.2 State the ambiguity default as a property — the default names an engine known to be available — and note that `@ast-grep/cli` ships as a dependency while the Vale binary is external, so `sg` satisfies it locally
- [ ] 3.3 Carry the three boundary cases: prose-about-code vs structure, Vale is per-document (cross-document prose consistency is `runtime`), and `sg`/`vale` are both static-tier so trust tier is a separate axis
- [ ] 3.4 Keep the topic scoped to engine choice — no authoring-destination guidance, no tool-calling mechanics from the seed's source prompt
- [ ] 3.5 Register the topic in the help index and add `route`/`static` cross-references to it
- [ ] 3.6 Tests: the topic resolves via `taskless help` and appears in the index; the topic file matches the established recipe header/format convention

> Export via `@taskless/cli/prompts` is not part of this change (see D9). Whichever of this change and `export-knowledge-prompts` lands second adds the one-line `TOPICS` entry.

## 4. Quality gates

- [ ] 4.1 `pnpm --filter @taskless/cli typecheck && lint && test` clean
- [ ] 4.2 With the Vale binary absent, confirm ast-grep and runtime results still return and only Vale reports unavailable
