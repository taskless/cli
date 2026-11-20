# @taskless/vale-grammars

The tree-sitter grammar modules that [Vale](https://vale.sh) uses to read
comments in source code, redistributed as an npm package so that
`@taskless/cli` can hand them to Vale with no download step at install or lint
time.

Since Vale 3.27.0 these grammars are WebAssembly modules that ship separately
from the Vale executable, and Vale normally installs them with `vale sync`.
Without them Vale finds comments by their delimiters, which lints linter
directives such as `//nolint` as prose and misses a one-line CSS `/* … */`
comment. `@taskless/cli` names this package's `grammars/` directory to Vale
through `VALE_GRAMMARS_PATH` instead.

## What the published tarball holds

`grammars/<name>.wasm` for every grammar upstream publishes with the Vale
release, this README, Vale's upstream `LICENSE`, and `package.json`. Nothing
else: no `bin` entry, no JavaScript, and no lifecycle script.

There is one package for every platform, with no `os` or `cpu`, because a
WebAssembly module is the same bytes on every host. A grammar therefore cannot
be one version on macOS and another on Linux.

## Versioning

Published versions are `<valeVersion>-<yyyymmddhhmmss>`, exactly as the
`@taskless/vale-<os>-<cpu>` packages are, and the release workflow stamps all
of them with one version in one run. `@taskless/cli` pins this package and the
platform packages at that same exact version.

The `version` field in the repository is the placeholder `0.0.0`. The release
workflow overwrites it with the stamped version immediately before packing, and
the placeholder is never itself published.

## Where the grammars come from

The modules are not stored in this repository. `.github/workflows/release-vale.yml`
downloads each `grammar-<name>.zip` from the upstream Vale release, checks the
archive's SHA256 against the digest committed in
`.github/scripts/vale-manifest.json`, refuses to go further on a mismatch, and
only then reads the one `.wasm` member out of it.

Upstream's `vale_<version>_checksums.txt` does not cover these archives. Each
committed digest is the one GitHub records for the release asset when it is
uploaded, which anyone can read back from the releases API to check it.

## License

Vale is MIT licensed, Copyright (c) 2016 Joseph Kato (errata-ai). The upstream
`LICENSE` ships in this package unmodified. Each grammar module is compiled by
the Vale project from the corresponding tree-sitter grammar, and upstream
distributes the modules without separate license files. This package
redistributes that build and is not affiliated with or endorsed by the Vale
project.
