# @taskless/vale-linux-x64

The [Vale](https://vale.sh) executable for x86-64 Linux, redistributed as an npm
package so that `@taskless/cli` can resolve and run it with no download step at
install time.

## What the published tarball holds

`vale`, this README, Vale's upstream `LICENSE`, and `package.json`.
Nothing else: no `bin` entry, no JavaScript, and no lifecycle script. A consumer
locates the executable by resolving this package and running the file by path,
so the binary is usable even where the consuming package manager refuses to run
dependency build scripts, which pnpm 10 does by default.

`os` and `cpu` are declared, so this package installs only on a matching host
and is skipped everywhere else without failing the install.

## Versioning

Published versions are `<valeVersion>-<yyyymmddhhmmss>`: the upstream Vale
release this package carries, then the UTC timestamp of the publishing run.
`3.17.1-20260806120000` carries Vale 3.17.1. A plain `3.17.1` is never
published.

Every published version is therefore a semver prerelease, which is the point: a
caret or tilde range over the Vale version matches no published version, so a
consumer has to name one exact version and cannot float across releases.

The `version` field in the repository is the placeholder `0.0.0`. The release
workflow overwrites it with the stamped version immediately before packing, and
the placeholder is never itself published.

## Where the binary comes from

The binary is not stored in this repository. `.github/workflows/release-vale.yml`
downloads `vale_<version>_Linux_64-bit.tar.gz` from the upstream
release, checks the archive's SHA256 against the digest committed in
`.github/scripts/vale-manifest.json`, refuses to go further on a mismatch, and
only then unpacks `vale` into the package. Reproducing a published
tarball means re-running that fetch against the same upstream release; the
committed digest is what makes the result independently checkable, since it is
the same digest upstream publishes in `vale_<version>_checksums.txt`.

## glibc, and why there is no musl package

Vale's Linux build is dynamically linked against glibc (`ELF 64-bit LSB
executable, dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, for
GNU/Linux 3.2.0`), so it is not a static Go binary and it does not run on
musl-based distributions such as Alpine. Upstream publishes no musl asset, so
there is nothing to package for those hosts; they fall back to a `vale` found
on `PATH`.

## License

Vale is MIT licensed, Copyright (c) 2016 Joseph Kato (errata-ai). The upstream
`LICENSE` ships in this package unmodified. This package redistributes that
build and is not affiliated with or endorsed by the Vale project.
