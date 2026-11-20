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

### D3. Digests are recorded at detect time and reviewed, since upstream does not sign them

The manifest gains a `grammars` section: the package name and directory, the asset template `grammar-{name}.zip`, the archive member `styles/config/grammars/{name}.wasm`, and one `{ name, sha256 }` entry per grammar. `vale-detect.cjs` already runs without credentials. When upstream moves, it lists the release's `grammar-*.zip` assets, downloads each one, hashes it, and writes the list and digests into the manifest pull request. A human approves those digests exactly as they approve the binary digests. `vale-prepare.cjs` then verifies each archive against the committed digest before unzipping, and extracts only the named member, flattened to `grammars/<name>.wasm`.

This is trust-on-first-sight for the grammars, where the binaries are cross-checked against upstream's own checksums file. The review gate is the same; what is weaker is that a reviewer cannot compare the grammar digests with anything upstream published. That is the best upstream allows today, and it is stated in the manifest comment.

### D4. One stamp, one gate, one upgrade

`vale-prepare.cjs` emits the grammar tarball beside the six platform tarballs, at the same stamp, and the existing publish loop publishes all seven. `vale-gate.cjs` reports "already published" only when the platform packages and the grammar package both have a version for the pinned Vale release. `vale-upgrade-detect.cjs` and `vale-upgrade-wait.cjs` treat the grammar package as a seventh member of the set: the upgrade pull request is opened only when all seven are published, and it moves all seven pins together.

The CLI takes the grammar package as a regular dependency at an exact version, not an optional one, because there is no host that should go without it. `engine-version-consistency` asserts that the grammar pin's Vale component equals `VALE_VERSION` and the binary pins' Vale component. It does not require equal stamps: the manual first publish (Migration, step 2) stamps the grammar package once on its own.

### D5. `VALE_GRAMMARS_PATH` is set at the single spawn site, from a resolver beside `findValeBinary`

A sibling of `findValeBinary` resolves `@taskless/vale-grammars/package.json` and returns `<package>/grammars`. It is cached per process, and a miss is reported as a value with the locations searched, as the binary resolver does. `spawnVale` adds `VALE_GRAMMARS_PATH` to the child environment it already builds for `PATH`. When the grammar package does not resolve, the variable is left unset and Vale runs. Its `W101` warnings then reach the user as notices, by the existing "diagnostics on a successful run" requirement. That is loud enough for a broken install, and it does not take the Markdown rules down with the code rules.

It is set whichever tier resolved the binary. A `vale` from `PATH` older than 3.27.0 ignores the variable and uses its built-in grammars, so setting it costs nothing there.

The resolver and the package spec are exported from `@taskless/cli/node/runtimes` next to `VALE_BINARY`, so the rule generator's verifier runs Vale with the same grammars.

_Alternative: copy the grammars into `<StylesPath>/config/grammars/` at assembly._ That copies 65 MB into the user's `.taskless/` tree, and makes our own grammars indistinguishable from the third-party ones D7 refuses.

### D6. Coverage is asked of the binary, in the vendor contract

The vendor contract runs every comment-tier extension in `VALE_FORMAT_TIERS` through the pinned binary with the pinned grammars. It fails on any `grammar "<name>" is not installed` warning, naming the extension and the grammar. The binary is the authority on which grammar an extension needs, so the test asks it rather than keeping a mapping. The six cases failing on #703 stay as they are, and pass again once the grammars are present.

### D7. The rules-tree grammar directory is refused at assembly

`assembleValeConfig` checks for `<rules tree>/config/grammars/` before writing anything. When it exists, the result is a refusal naming the directory. That refusal is a tree-level entry beside the existing per-rule ones, reported the same way, so `validate` and `check` both refuse through the code they already share. Its presence is refused, not its contents, because an empty directory today becomes a populated one after the next `vale sync`, and an unvetted grammar would win over ours for that language. The rest of `config/` (vocabularies, for example) is not touched by this change.

## Risks / Trade-offs

- [Install grows by about 15 MB compressed and 65 MB unpacked] → Accepted; it is the price of offline, identical behavior. D2 keeps the cost of the two unused grammars at about 1 MB.
- [Upstream grammar digests have no upstream checksum to compare against] → Same review gate as the binaries, stated in the manifest comment. Revisit if upstream starts covering them.
- [A grammar ABI mismatch between a `PATH` Vale and our grammars] → Only reachable when the pinned platform package did not install, which the binary resolver already reports by tier (`source`). Vale's own error would surface as a notice or failure.
- [The publish gate fires on the PR A merge, and the grammar name does not exist yet] → The first publish happens before PR A merges (Migration, step 2), so the gate sees all seven published and does nothing.
- [Upstream renames or drops a grammar a tier extension needs] → D6 fails the upgrade pull request, naming the extension.

## Migration Plan

1. **PR A** (bottom, to `main`): this change's artifacts, the manifest `grammars` section for 3.27.0 with digests computed from upstream's current assets, `packages/vale-grammars/` metadata, and the detect, prepare, gate and upgrade script changes with their tests. It changes no CLI behavior and carries no changeset.
2. **Manual, before merging PR A**: a maintainer runs `vale-prepare.cjs` on PR A's branch, publishes the `@taskless/vale-grammars` tarball by hand with `--tag latest`, and registers its npm trusted publisher against `release-vale.yml` and the `npm-autopublish` environment.
3. Merge PR A. The gate finds 3.27.0 published for all seven packages and publishes nothing. `vale-upgrade.yml` rewrites #703 to include the grammar pin.
4. **PR B**, cut from #703's head and targeting `main`: the grammar dependency pin, the resolver and `VALE_GRAMMARS_PATH`, the runtime export, the D7 refusal, the D6 coverage check, the `update` ledger entry, and the grown `vale-3-27-0` changeset (patch). It archives this change. #703 is closed with "Superseded by #<B>" once PR B lands.

Rollback: revert PR B. The 3.26.0 pins come back and the grammar package becomes inert, since nothing pins it. PR A can stay.

## Open Questions

- Whether `vale-upgrade.yml`'s rolling branch rewrites #703 after step 3 or opens a fresh pull request. Either way, PR B is cut from whichever head carries the seven pins.
