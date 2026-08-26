---
"@taskless/cli": patch
---

Resolve the ast-grep binary without relying on an install-time step, and drop
the `@ast-grep/cli` wrapper from what consumers install.

- **The wrapper moves to `devDependencies`.** The seven `@ast-grep/cli-<platform>`
  packages were already declared in `optionalDependencies`, and the CLI already
  resolved them by path — the wrapper was a leftover whose only job is a
  `postinstall` that hardlinks the binary into itself so its `bin` entries work.
  Nothing here invoked those entries. Consumers now install only the platform
  package matching their host, and the wrapper's `postinstall` — which leaves a
  placeholder text file where the binary should be under `pnpm dlx`'s strict
  isolation — is out of the shipped product entirely. It stays as a
  `devDependency` because `fetch-ast-grep-schema` reads its version.
- **Platform packages are pinned exactly.** They were carets, and the wrapper
  had been enforcing alignment implicitly by pinning its own
  `optionalDependencies`; without it, two hosts could resolve different ast-grep
  versions against the same rules and disagree about findings. This change makes
  the pin explicit without moving the version; the upgrade itself is a separate
  change.
- **Binary resolution exhausts every candidate before failing.** It now searches
  the platform package, `node_modules/.bin`, then `sg` and `ast-grep` on `PATH`,
  and throws naming what it tried. Previously it returned a bare `"sg"` and let
  `spawn`'s `ENOENT` be the error, from a caller that could not say where it had
  looked.

Alpine improves as a side effect: upstream publishes no musl build and marks its
Linux packages `libc: ["glibc"]`, so today the wrapper's `postinstall` resolves a
package that does not exist and exits 1, failing the install wherever dependency
scripts run. Installing now succeeds and resolution falls through to `PATH`.
