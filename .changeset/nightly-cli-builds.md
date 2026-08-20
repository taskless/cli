---
"@taskless/cli": patch
---

Split the release pipeline so each workflow file carries one release design.

`release.yml` held two jobs with opposite trust properties behind one header.
It is now `release-cli-changeset.yml` — which reads contributor-authored
changesets and opens the Version Packages PR holding no npm credential and no
OIDC identity — and `release-cli.yml`, which keeps the credential-free
"is this version already on npm?" gate together with the publish job it
protects, so an OIDC-capable job is never instantiated on an ordinary merge.
`vale-binaries.yml` is renamed `release-vale.yml` to match.

The build and publish steps themselves are unchanged — same triggers, same
`permissions: {}`, same action pins, same OIDC trusted publishing behind the
same `npm-production` approval. Two operational details do differ: `check` and
`publish` no longer share the `release-*` concurrency group, and the release
now runs as two workflow runs instead of one, so its check contexts are
`Release CLI Version PR / …` and `Release CLI / …` rather than `Release / …`.
Neither is a required check.

The header comments also get one correction: they claimed `npm-production` had
no required reviewers, and it has had one all along, so a release has always
waited for a human approval that the file said was not there.

Publish unreleased work on `main` as `@taskless/cli-nightly`.

Every push to `main` that has changesets pending now publishes the CLI under a
second package name, stamped `<next-version>-<yyyymmddhhmmss>x<short-sha>` — so
merged-but-unreleased behavior is installable with `npx @taskless/cli-nightly`.
A nightly is the same build as the release it anticipates and keeps the
`taskless` executable, so it is a drop-in; the rename happens at pack time, so
`@taskless/cli`'s own version history stays releases-only. Installing both
globally collides on the binary and is unsupported.

Two credential-free gates decide whether anything is built — pending changesets
first (before any install), then whether the commit already has a nightly — so
the publishing job is never instantiated on an ordinary push, and the merge of a
Version Packages PR publishes the real release and no nightly with no rule
special-casing it.
