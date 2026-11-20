## Context

See proposal.md, "Why", for the regression. The facts below were measured on the pinned `vale 3.27.0` (darwin-arm64) and decide the approach:

- Vale looks for a grammar in `<StylesPath>/config/grammars/<name>.wasm`, then in the directory named by the `VALE_GRAMMARS_PATH` environment variable. The fallback works **one grammar at a time**: a StylesPath holding only `go.wasm`, plus `VALE_GRAMMARS_PATH` holding every grammar, parsed Go, CSS and Python with real grammars and emitted no `W101`. An empty `config/grammars/` directory behaves the same.
- Upstream publishes 22 `grammar-<name>.zip` assets on each release. Each zip holds `styles/config/grammars/<name>.wasm`. They total about 15 MB zipped and 65 MB unpacked. `vale_<version>_checksums.txt` covers the six binary archives and `vale_<version>_wasm.tar.gz`, and **not** the grammar zips.
- Probing every comment-tier extension in `VALE_FORMAT_TIERS` against the bare binary names 20 grammars: bash, c, cpp, csharp, css, elixir, elm, go, java, javascript, julia, kotlin, lua, php, proto, python, ruby, rust, tsx, typescript. `.clj`, `.ps1` and `.qdoc` name none, because Vale reads them by delimiters with or without a grammar, as on 3.26.0. `toml` and `yaml` are unused today.
- With all 22 grammars supplied through `VALE_GRAMMARS_PATH`, all 373 Vale tests pass on 3.27.0, the six failing vendor-contract cases included.
- The CLI spawns Vale in exactly one place, `spawnVale` in `src/rules/vale/run.ts`. `verify` reaches it through `runVale`. Every assembled config sets `StylesPath` to the Vale rules tree (`.taskless/rules/vale`, `valeHeader` in `src/rules/assemble.ts`), and `verify` uses a scratch StylesPath of its own.
- The platform packages' release (`release-vale.yml`) already downloads, verifies against the manifest, stamps, packs, and publishes every tarball `vale-prepare.cjs` emits. The publish loop is generic over tarballs.

## Goals / Non-Goals

**Goals:**

- Vale 3.27.0 behaves for a Taskless user exactly as 3.26.0 did, on every OS, with no network at lint time.
- Grammar bytes pass through the same review-gated manifest as the binaries.
- A future grammar gap fails CI instead of quietly falling back.

**Non-Goals:**

- Supporting Vale's `Lang` models (French, German, Spanish). Nothing the CLI assembles sets `Lang`.
- Honoring a user's own `vale sync`. Grammars outside the Vale rules tree are never read; the one inside it is refused.
- Shrinking the install by shipping a subset of grammars (see D2).

## Decisions

### D1. One platform-independent package, not grammars inside each platform package

Grammars are WebAssembly, so the bytes are the same on every host. A single `@taskless/vale-grammars` package is installed once per host, at one version, and cannot differ between macOS and Linux.

_Alternative: add the grammars to each of the six platform packages._ It needs no new npm name and no manual first publish. It was rejected because it publishes the same 15 MB six times, and turns "every OS has the same grammars" from a structural fact into something only the pipeline's discipline maintains.

### D2. Ship every grammar upstream publishes

The package carries all of upstream's grammars for the release, not the 20 the comment tier needs today. The extra two cost about 1 MB. Shipping the whole set means the manifest's grammar list is upstream's list, with no hand-maintained subset to drift. A new comment-tier row then needs no packaging change, and the coverage check (D6) is a check on upstream, not on our arithmetic.

_Alternative: ship only the probed subset._ It is smaller by about 7%, but it adds a table that has to be re-derived on every bump and that only fails after it is already wrong.

### D3. Digests come from GitHub's record of each release asset, and are reviewed

The manifest gains a `grammars` section: the package name and directory, the asset template `grammar-{name}.zip`, the archive member `grammar-{name}/styles/config/grammars/{name}.wasm`, and one `{ name, sha256 }` entry per grammar, sorted by name. When upstream moves, `vale-detect.cjs` reads the release's asset list from the GitHub releases API. That list carries a `digest` (`sha256:<hex>`) for each asset, recorded by GitHub when upstream uploaded it. Detect takes every `grammar-*.zip` asset and its digest into the manifest pull request, and refuses an asset with no recorded digest. A human approves those digests exactly as they approve the binary digests.

Upstream's checksums file does not cover the grammar archives, so GitHub's record is the independent source here. It is not upstream's signature, but it is not a digest of our own download either: anyone can read it back from the API. All 22 digests for 3.27.0 matched a local download when this was written.

`vale-prepare.cjs` verifies each archive against the committed digest before reading anything out of it. It then streams the single named member to stdout with `unzip -p` rather than extracting it, so no archive path ever reaches the filesystem. That is why the grammar member may be nested, where a platform's `archiveMember` must stay a flat filename. The bytes must start with the WebAssembly magic (`\0asm`), which catches a member template that names the wrong file. Each module is written to `grammars/<name>.wasm`.

### D4. One exact stamp, one gate, one upgrade

`vale-prepare.cjs` emits the grammar tarball beside the six platform tarballs, at the same stamp, and the existing publish loop publishes all seven. `vale-gate.cjs` reports "already published" only when the platform packages and the grammar package both have a version for the pinned Vale release.

`vale-upgrade-detect.cjs` already requires every `@taskless/vale-*` pin in the CLI, and the latest published version of each, to be one exact stamped version. The grammar package matches that prefix, so once the CLI pins it, it is a seventh member of that set with no script change. The upgrade pull request is then opened only when all seven are published at one version, and it moves all seven pins together. `vale-upgrade-wait.cjs` asks the same question through `vale-upgrade-detect.cjs --json`.

That invariant is kept, not relaxed, which shapes the bootstrap. The binaries for 3.27.0 are already published at `3.27.0-20261117230017`, so the grammar package's manual first publish must carry that same stamp. `vale-prepare.cjs` takes `--version <stamped>` for this, and refuses a stamp whose Vale component is not the manifest's. Every later release stamps all seven in one run.

The CLI takes the grammar package as a regular dependency at an exact version, not an optional one, because there is no host that should go without it.

### D5. `VALE_GRAMMARS_PATH` is set at the single spawn site, from a resolver beside `findValeBinary`

A sibling of `findValeBinary` resolves `@taskless/vale-grammars/package.json` and returns `<package>/grammars`. It is cached per process, and a miss is reported as a value with the locations searched, as the binary resolver does. `spawnVale` adds `VALE_GRAMMARS_PATH` to the child environment it already builds for `PATH`. When the grammar package does not resolve, the variable is left unset and Vale runs. Its `W101` warnings then reach the user as notices, by the existing "diagnostics on a successful run" requirement. That is loud enough for a broken install, and it does not take the Markdown rules down with the code rules.

It is set whichever tier resolved the binary. A `vale` from `PATH` older than 3.27.0 ignores the variable and uses its built-in grammars, so setting it costs nothing there.

The resolver and the package spec are exported from `@taskless/cli/node/runtimes` next to `VALE_BINARY`, so the rule generator's verifier runs Vale with the same grammars.

_Alternative: copy the grammars into `<StylesPath>/config/grammars/` at assembly._ That copies 65 MB into the user's `.taskless/` tree, and makes our own grammars indistinguishable from the third-party ones D7 refuses.

### D6. Coverage is asked of the binary, in the vendor contract

The vendor contract runs every comment-tier extension in `VALE_FORMAT_TIERS` through the pinned binary with the pinned grammars. It fails on any `grammar "<name>" is not installed` warning, naming the extension and the grammar. The binary is the authority on which grammar an extension needs, so the test asks it rather than keeping a mapping. The six cases failing on #703 stay as they are, and pass again once the grammars are present.

### D7. One check for the rules-tree grammar directory, called by `validate` and by assembly

`validate` and `check` do not share an assembly path: `validate` judges one rule at a time in `inspect.ts`, while `check` refuses through `assembleValeConfig`. So the check is one function, `valeTreeGrammarsViolation`, that both call, under a new constraint `vale-tree-no-grammars` in the published constraint table. `validate` reports it against every Vale rule, since the tree is every rule's StylesPath. Assembly returns a refusal carrying it as a tree-level rejection beside the per-rule ones, and `check` reports it as the Vale engine's failure, with other engines still running.

Its presence is refused, not its contents, because an empty directory today becomes a populated one after the next `vale sync`, and an unvetted grammar would win over ours for that language. The rest of `config/` (vocabularies, for example) is not touched by this change.

The same reasoning covers the environment. `VALE_GRAMMARS_PATH` is always replaced in the child environment, never inherited, because a value from the user's shell is also a grammar directory nobody pinned. When the grammar package does not resolve, the variable is dropped rather than inherited.

## Risks / Trade-offs

- [Install grows by about 15 MB compressed and 65 MB unpacked] → Accepted; it is the price of offline, identical behavior. D2 keeps the cost of the two unused grammars at about 1 MB.
- [Upstream grammar digests have no upstream checksum to compare against] → Same review gate as the binaries, stated in the manifest comment. Revisit if upstream starts covering them.
- [A grammar ABI mismatch between a `PATH` Vale and our grammars] → Only reachable when the pinned platform package did not install, which the binary resolver already reports by tier (`source`). Vale's own error would surface as a notice or failure.
- [The publish gate fires on the PR A merge, and the grammar name does not exist yet] → The first publish happens before PR A merges (Migration, step 2), so the gate sees all seven published and does nothing.
- [Upstream renames or drops a grammar a tier extension needs] → D6 fails the upgrade pull request, naming the extension.

## Migration Plan

1. **PR A** (bottom, to `main`): this change's artifacts, the manifest `grammars` section for 3.27.0 with digests computed from upstream's current assets, `packages/vale-grammars/` metadata, and the detect, prepare, gate and upgrade script changes with their tests. It changes no CLI behavior and carries no changeset.
2. **Manual, before merging PR A**: a maintainer runs `node .github/scripts/vale-prepare.cjs --only grammars --version 3.27.0-20261117230017` on PR A's branch, publishes the resulting `@taskless/vale-grammars` tarball by hand with `npm publish --access public --tag latest`, and registers its npm trusted publisher against `release-vale.yml` and the `npm-autopublish` environment.
3. Merge PR A. The gate finds 3.27.0 published for all seven packages and publishes nothing. The CLI does not pin the grammar package yet, so `vale-upgrade.yml` still sees six pins.
4. **PR B**, cut from #703's head and targeting `main`: the grammar dependency pin, the resolver and `VALE_GRAMMARS_PATH`, the runtime export, the D7 refusal, the D6 coverage check, the `update` ledger entry, and the grown `vale-3-27-0` changeset (patch). It archives this change. #703 is closed with "Superseded by #<B>" once PR B lands.

Rollback: revert PR B. The 3.26.0 pins come back and the grammar package becomes inert, since nothing pins it. PR A can stay.
