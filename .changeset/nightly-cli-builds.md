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
