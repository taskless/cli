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

Nothing about how `@taskless/cli` is built, versioned, or published changes.
The header comments do get one correction: they claimed `npm-production` had no
required reviewers, and it has had one all along, so a release has always
waited for a human approval that the file said was not there.
