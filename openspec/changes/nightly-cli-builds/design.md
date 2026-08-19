## Context

**Current state.** `.github/workflows/release.yml` holds three jobs. `version` runs `pnpm bump` and opens the "Version Packages" PR; it reads contributor-authored changeset text and deliberately holds no npm credential and no OIDC identity. `check` asks, credential-free, whether `packages/cli/package.json`'s version is already on npm. `publish` runs only when it is not — which in practice means only on the merge of the Version Packages PR — and holds `id-token: write` against the `npm-production` environment. A single `concurrency: release-${{ github.ref }}` group serializes all of it.

That split is the file's whole security argument, stated in its header: the changeset text is fully consumed by the credential-free job and never reaches the credentialed one, and the credential-free `check` gate is what keeps an OIDC-capable job from existing on ordinary pushes. Everything below preserves that argument; nothing here relaxes it.

`.github/workflows/vale-binaries.yml` is the closest working precedent for what the nightly needs: a differently-named set of packages, a stamped prerelease version that npm has never seen, its own gate job, and its own publish job. Its header already records two lessons this change reuses — `--tag latest` is required for a prerelease, and a publish failure in a retry-safe loop is treated as possibly-already-published rather than as an error.

**Two facts about the live configuration.** `npm-production` has `required_reviewers` (`gh api repos/taskless/cli/environments`). `release.yml`'s header comment says the opposite — "No required reviewers (fully automatic once the Version Packages PR merges), by design" — and has been wrong for as long as the reviewer has been configured. An unattended nightly therefore cannot use `npm-production`: it would sit waiting for a click that defeats the point.

**What is unreachable today.** Between releases, merged work is not installable. `@taskless/cli` is a workspace package with a build step, so no `npx` against a branch or an archive produces a working CLI. The reachable options were "nightly from `main`" or "no nightly."

## Goals / Non-Goals

**Goals:** make every unreleased `main` commit installable; keep the credential-free/credentialed split intact and easier to read after the change than before; give each release flow one design and one file; let flows whose review gate is elsewhere publish without a second, redundant approval.

**Non-Goals:** publishing from pull requests; publishing unreviewed code; changing what `@taskless/cli` releases require; pruning old nightly versions; changing the Vale detect/verify pipeline beyond its environment; making a nightly and a release co-installable.

## Decisions

### D1 — Build from `main`, never from a pull request

An earlier draft published on PR update. Building from `main` — the same shape `vale-binaries.yml` already uses — is both simpler and the only version that is safe.

**It removes the security problem instead of containing it.** A PR-triggered publish inverts `release.yml`'s split: contributor-authored changeset text would flow into a job holding an OIDC identity, and _unreviewed code_ would be published to npm under the `@taskless` scope. Making that safe needs a hard fork-PR exclusion plus a careful job split — a containment structure, where building from `main` means the failure cannot arise. The only code that can be published is code that already merged.

**Tying builds to changeset edits does not work anyway.** The natural PR-side trigger is "the changeset changed," but a changeset is typically written early and the implementation lands after it. Measured on the live #71→#106 stack: `add-vale-rule-engine` had **7** commits after its last changeset edit, `agent-command-and-vale-authoring` had **11**. A nightly stamped at changeset-edit time would omit all of them while looking current — worse than no artifact, because it looks like evidence.

**Nothing is given up.** This tests what is unreleased rather than what is unmerged. Installing an unmerged PR was never available.

- **Alternative — publish on PR update with a fork exclusion:** rejected. It publishes unreviewed code under our scope, and the changeset-edit trigger is measurably stale.
- **Alternative — a nightly cron rather than per-push:** rejected. A push is what changes the answer; a cron either re-publishes an unchanged SHA (the SHA gate suppresses it) or delays a build by up to a day for no gain.

### D2 — A separate package, `@taskless/cli-nightly`, with `bin` unchanged

Publishing prereleases into `@taskless/cli` would fill its version list with builds nobody should install deliberately, and every `npm view`, changelog, and release page would carry them. A separate name keeps the release history of the product clean.

The rename is a **pack-time rewrite of `packages/cli/package.json`**, exactly as `vale-prepare.cjs` already stamps the Vale packages. The committed `package.json` is unchanged, so nothing about the ordinary release path is touched, and a nightly is byte-for-byte the same build as the release it anticipates apart from `name` and `version`.

- **`bin` stays `taskless`.** A nightly is a drop-in for the real thing, so every documented invocation, every skill, and every recipe works unchanged against it. Installing both globally collides on the binary; that is not a supported configuration and does not need to be.
- **`optionalDependencies` are untouched.** The nightly points at the same published, pinned Vale and ast-grep platform packages. It does not fork them, and it does not get a nightly of them.
- **`--provenance` stays on.** The attestation matters more for an unattended publish, not less.

### D3 — `n.m.k-yyyymmddhhmmssx<sha>`

```
0.11.0-20260818123456x05b3c88
```

Reads as: _the future `0.11.0`, built at that time, from that commit._ Both halves earn their place.

- **The timestamp sorts.** It is fixed-width and leading, so an ASCII-lexical comparison of the prerelease identifier orders builds chronologically. A bare SHA does not sort at all, and "which nightly is newer" is the first question anyone asks.
- **The SHA identifies and dedupes.** It answers "should this run?" — if a published version ends in `x<sha>`, the commit already has a nightly and a re-run is a no-op.

**The `x` is load-bearing, not decoration.** Semver compares a dot-separated prerelease identifier consisting only of digits _numerically_, and forbids a leading zero in a numeric identifier. `20260818123456` followed by a short SHA of `05b3c88` would, without the `x`, be a single all-digit identifier for roughly one commit in sixteen — intermittently invalid, which is the worst failure cadence available. The `x` makes the identifier alphanumeric, so the numeric rule never applies.

**Dedupe is a list-and-filter, not a point lookup.** Because the timestamp precedes the SHA, the exact version string is not known before the run computes it. `npm view @taskless/cli-nightly versions --json` and test for a version ending in `x<sha>`.

**`--tag latest` on publish is mandatory.** Every version here is a semver prerelease, and npm will not move `latest` onto a prerelease unless told to. Without it, `npm i @taskless/cli-nightly` resolves nothing useful — the package would have versions and no default. `vale-binaries.yml` already records this lesson; this is the second package to need it.

**There is no tag bookkeeping beyond that, deliberately.** `latest` is correct in every instance this package ever produces: each publish is the newest build of `main`, and nobody resolves a nightly by range — the prerelease component exists to make the version sortable and traceable, not to offer a channel to pin. So there is no second dist-tag to maintain, no promotion step, and no state that can drift.

The case worth naming, since a reviewer will reach for it: a publish that succeeds while the tag move does not, leaving a version on the registry that `latest` does not point at. Gate 2 tests existence, so a re-run on that same commit is skipped and does not repair it. That is accepted rather than mitigated. The condition lasts until the next nightly, which is the next push to `main` with changesets pending, and that publish sets `latest` correctly with no intervention. Building a re-tag path would add a repair mechanism, and a state for it to detect, for a window that closes on its own — and it is worth remembering that gate 2 skipping a re-run is right on its own terms: identical bytes, nothing new to publish.

This deliberately differs from `@taskless/vale-*`, which stamps `n.m.k-yyyymmddhhmmss` with no SHA. Vale republishes upstream binaries and has no commit of ours to key on.

- **Alternative — `0.11.0-nightly.N` with an incrementing counter:** rejected. It needs state outside the build to know `N`, and it cannot answer "was this SHA built?" without a lookup table.
- **Alternative — SHA only:** rejected. Unsortable.
- **Alternative — timestamp only (the Vale scheme):** rejected. It cannot dedupe a re-run, and a workflow re-run would mint a second version of identical bytes.

### D4 — Two gates, in order: empty `.changeset/`, then unbuilt SHA

**Gate 1 — is `.changeset/` empty?** No changeset files means nothing is pending: `main` is at its released version and there is no future `n.m.k` to name. This is a directory listing. It needs no tooling, runs before anything is installed, and is the cheapest possible early exit on the overwhelmingly common push.

It also makes the Version Packages PR merge **self-handling, with no special case**. That merge consumes every changeset and bumps `package.json`, so on that push the directory is empty, no nightly is built, and `release-cli.yml` publishes the real release instead. The two flows do not need to know about each other.

Because gate 1 is a directory check, the workflow never depends on how `changeset status` behaves with nothing pending — a behavior we would otherwise have to pin down and keep pinned down.

**Gate 2 — has this SHA already been published?** A version ending in `x<sha>` means the commit has a nightly. Re-runs, and any future trigger that fires twice for one commit, publish nothing.

Only past both gates does the build run, taking `newVersion` from `changeset status` as `n.m.k`.

**Reading the bump.** `changeset status --output=<relative-path>` writes:

```json
[
  {
    "name": "@taskless/cli",
    "type": "minor",
    "oldVersion": "0.10.2",
    "newVersion": "0.11.0"
  }
]
```

Three traps, all silent.

**The path must be repo-relative** — an absolute `/tmp/...` path fails to write the file without failing the command. **The JSON file is authoritative, not stdout**, which also carries unrelated workspace-version warnings. Read the file.

And **the output is an array, so select by name, never by index.** It lists every package the pending changesets release. `[0]` is `@taskless/cli` only for as long as the CLI is the sole changesets-managed package, and the six `@taskless/vale-*` packages already sit in the changesets `ignore` list precisely because a second managed package is a thing that happens. The day one is added, `[0]` stamps the nightly with another package's version — a wrong version that publishes successfully and looks plausible. Match on `name === "@taskless/cli"`.

**Chore merges.** A chore adds no changeset, so it never _starts_ a nightly. It will produce a new nightly if changesets are already pending, because the SHA moved and gate 2 is per-SHA. That is accepted: the nightly claims to be "this commit of `main`," and a chore does produce a new commit of `main`. If it becomes noisy, the fix is an additional gate on `packages/cli/**` having changed since the last nightly — deliberately not built now, because the cost is a version string nobody will notice.

### D5 — Four workflows, one release design each

`release.yml` currently holds two jobs with opposite trust properties, and its header is already stale about the environment. Split so each file carries one design and one self-contained trust story:

| File                        | Trigger                   | Does                                                                               | Credential                 |
| --------------------------- | ------------------------- | ---------------------------------------------------------------------------------- | -------------------------- |
| `release-cli-changeset.yml` | push to `main`            | `pnpm bump`, open/update the Version Packages PR                                   | none                       |
| `release-cli.yml`           | push to `main`            | publish `@taskless/cli` when its version is not yet on npm                         | `npm-production`, approval |
| `release-vale.yml`          | schedule + push to `main` | Vale detect → manifest PR → stamp → publish                                        | `npm-autopublish`          |
| `release-cli-nightly.yml`   | push to `main`            | publish `@taskless/cli-nightly` when changesets are pending and the SHA is unbuilt | `npm-autopublish`          |

**The `check` job travels with the publish it gates.** The credential-free "is main's version already on npm?" question is what keeps an OIDC-capable job from being instantiated on ordinary pushes. Separating it from `release-cli.yml` would leave a gate in one file and the thing it protects in another — the arrangement most likely to be broken by a later edit that reads only one of them.

The split is otherwise a move, not a rewrite. Each file keeps the header comment explaining its own trust story, and the credential-free/credentialed boundary is unchanged in substance — only more legible, because a reader of `release-cli.yml` no longer has to work out which half of the file applies.

### D6 — Concurrency narrows to the flow that needs it

Today one group serializes `version` and `publish`. After the split:

- **`release-cli-changeset.yml` keeps `concurrency: release-${{ github.ref }}`.** It is the flow that cares. Two pushes racing on the Version Packages PR branch is a real failure and the group prevents it.
- **`release-cli.yml` runs unserialized, deliberately.** Its credential-free gate makes a duplicate publish a no-op: the second run sees the version on npm and does nothing. The residual TOCTOU — two runs both observing "not published" — is handled the way `vale-binaries.yml` already handles it, by treating a publish failure as possibly-already-published rather than as an error. Serializing would buy nothing the gate does not already provide, at the cost of queueing releases behind unrelated pushes.
- **`release-cli-nightly.yml`** has the same property for the same reason: gate 2 is per-SHA, and two runs for one SHA cannot both publish.

Stating this explicitly matters because the obvious reading of the split — "the group was on the file, so put it on all four files" — would serialize flows that have no reason to wait on each other.

### D7 — `npm-autopublish`, and Vale moves into it

`npm-production` has a required reviewer, so an unattended flow cannot use it. Rather than removing that reviewer or granting the nightly an exception, add a second environment, **`npm-autopublish`**, for flows that publish without a human click — and move Vale into it too.

**Why Vale belongs there.** Its review gate is already in the right place, and the environment approval is a second copy of it. `vale-binaries.yml` only ever publishes a version a human reviewed in the manifest-update PR, digests and all; and `@taskless/cli` pins exact versions, so an auto-published Vale package reaches no user until someone deliberately bumps that pin. Re-approving each Vale version adds friction at a point where nothing is actually being decided — which is the kind of approval that gets clicked without being read, weakening the approvals that do matter.

The boundary that results is worth stating as a rule:

> **Approval gates what users get by default. Code review gates what gets published.**

| Flow                          | Environment       | Approval                                |
| ----------------------------- | ----------------- | --------------------------------------- |
| CLI release (`@taskless/cli`) | `npm-production`  | required reviewer                       |
| Vale platform packages        | `npm-autopublish` | none — gated by the manifest PR         |
| CLI nightly                   | `npm-autopublish` | none — gated by branch policy on `main` |

`npm-autopublish` still earns its place with no reviewer: it is the audit and scoping boundary, it carries a branch policy restricting it to `main`, and it is where the npm trusted-publisher bindings live.

- **Alternative — drop the reviewer from `npm-production` and share one environment:** rejected. That reviewer is the gate on what users get by default, which is precisely the thing the nightly does not need and the release does.
- **Alternative — a third environment, one per flow:** rejected. Two flows with identical properties do not need two names for the same policy.

### D8 — Two prerequisites are human-gated, and the delivery shape is built around them

Neither can be done by an implementer, tested around, or discovered late without stalling the work:

1. **The `npm-autopublish` environment** must be created in repository settings, with a branch policy limiting it to `main` and no required reviewers.
2. **A trusted-publisher binding for `@taskless/cli-nightly`** must be registered on npm. Trusted publishing is configured per package and the package does not exist yet, so — exactly as `vale-binaries.yml` documents for its six names — the **first publish is a deliberate manual step by a maintainer**, who then registers the binding. There is no fallback token path, by design.

Until both exist, the nightly workflow cannot be verified end to end: a run either fails on an unknown environment or fails the OIDC handshake. This is a sequencing constraint on the change, not a footnote in a task list. Both prerequisites are satisfied before the nightly unit, for the reason given in D9.

### D9 — The nightly proves `npm-autopublish` before Vale is migrated onto it

`npm-autopublish` is a new credential path. Nothing has ever published through it, and two things about it are untested: whether the environment is configured such that a run can actually deploy to it, and whether an npm trusted-publisher binding authorizes a workflow running under it.

That second one is a real risk, not a hypothetical. An npm trusted-publisher binding names the repository, the workflow file, and — where configured — the environment. The six `@taskless/vale-*` bindings were registered against `npm-production`. If they are environment-scoped, moving `release-vale.yml` to `npm-autopublish` means the first publish after that merge fails the OIDC handshake, and there is no stored `NPM_TOKEN` to fall back on because the absence of one is deliberate. The result would be **breaking a working release path in order to gain a convenience** — the worst available trade, and one only discovered after merge, since the failure is invisible until a Vale release actually needs publishing.

So the nightly goes first. It exercises exactly the same machinery — the same environment, the same OIDC handshake, the same trusted-publishing model — on a package where failure costs nothing: `@taskless/cli-nightly` is new, nothing depends on it, no consumer resolves it, and a failed first publish blocks nobody and breaks no release. Whatever the environment or the binding model turns out to require is learned there, on a disposable target, and by the time Vale moves the destination is proven rather than hoped for.

The general form, worth carrying past this change:

> **Prove a new credential path on something disposable before migrating something that works onto it.**

The check on whether Vale's bindings are environment-scoped (task 4.2) is not dropped by this ordering — it is _informed_ by it. After a nightly has published through `npm-autopublish`, that check has a known-good reference to compare against instead of being a question asked in the dark.

- **Alternative — Vale first, because it is a one-line change:** rejected. Diff size is not risk. The one-line change is the one that can break a path people depend on; the workflow-sized change is the one that cannot.
- **Alternative — migrate Vale and keep a stored token as a fallback:** rejected. Introducing a long-lived credential to de-risk a migration away from human approval gives back more than the migration is worth.

### D10 — Delivery shape: **stacked, merging forward**, in three PRs

Each unit is independently safe in production, and the ordering is set by D9 — prove the new credential path, then migrate onto it.

| #   | PR                             | Contains                                                                                                                                                                             | Safe alone?                                                                         |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 1   | Split the release workflows    | `release.yml` → `release-cli-changeset.yml` + `release-cli.yml`, `vale-binaries.yml` → `release-vale.yml`, corrected header comments, concurrency per D6. **No environment change.** | Yes — a behavior-preserving reorganization of what already runs.                    |
| 2   | Add the nightly                | `release-cli-nightly.yml`, the pack script, docs.                                                                                                                                    | Yes — and its failure mode is contained: nothing depends on the package (D9).       |
| 3   | Move Vale to `npm-autopublish` | One `environment:` line in `release-vale.yml`, plus the spec delta.                                                                                                                  | Yes — once PR 2 has demonstrated the environment and the handshake work end to end. |

Both human-gated prerequisites (D8) sit before PR 2: the `npm-autopublish` environment must exist, and `@taskless/cli-nightly` must have a trusted-publisher binding registered after its one-time manual first publish. PR 3 requires no new prerequisite of its own — only the evidence PR 2 produced.

Each PR is well under ~300 lines. Forward is correct rather than merely tidy: PR 1 leaves every existing flow working, PR 2 adds a package nobody consumes, and PR 3 changes one line on a path that has by then been proven. The last one to merge archives the change; the changeset lives on PR 1, the bottom of the stack, and grows as each unit lands.

If a prerequisite is not in place when PR 2 is ready, that PR waits. It does not merge with the environment referenced but absent, because the failure mode is a red release workflow on `main`, which is the thing everyone learns to ignore. Likewise PR 3 does not merge on a nightly that has not actually published — a green workflow that never reached the publish step proves nothing about the handshake.

## Risks / Trade-offs

- **A nightly and a release both install `taskless`** → accepted and documented (D2). Installing both globally collides; a nightly is a drop-in, not a companion.
- **Nightly versions accumulate without bound** → out of scope by decision. Every version is a prerelease and none is ever resolved by a range, so the cost is registry noise, not a wrong install.
- **`--tag latest` on a prerelease looks alarming** → it is required, not a shortcut (D3). These are the only builds of this package; the prerelease component exists to make the version sortable and traceable, not to signal instability.
- **The four-way split multiplies the places a trust story can go stale** → mitigated by giving each file one design to describe, which is the point of the split. The stale-comment bug being fixed here is itself evidence that two designs in one header is the harder thing to keep true.
- **A chore merge mints a nightly while changesets are pending** → accepted (D4), with a `packages/cli/**` gate named as the remedy if it becomes noise.
- **The first nightly publish is manual** → unavoidable (D8); npm has nothing to bind a trusted publisher to until the name exists. `vale-binaries.yml` documents the same one-time step for its packages, including publishing the packed tarball rather than the directory so the name is not burned on a placeholder version.
- **`changeset status` changes its output shape** → the nightly would fail to read `newVersion` and the build would fail loudly rather than publishing a wrong version. Acceptable; a mis-stamped nightly is worse than a missing one.
- **Vale's trusted-publisher bindings turn out to be scoped to `npm-production`** → mitigated by ordering (D9): the nightly proves the environment and the handshake first, on a package whose failure is free, so the Vale migration is attempted with the answer already known rather than discovered by a broken release.

## Migration Plan

PR 1 is a move: after it merges, `main` behaves exactly as before. PR 2 adds a workflow that publishes a package nobody depends on. PR 3 changes one environment reference, onto a path PR 2 has already exercised. There is no data migration and no consumer-visible change to `@taskless/cli`.

Rollback is per-unit and cheap: delete `release-cli-nightly.yml` (the published nightlies are inert), or point `release-vale.yml` back at `npm-production`. Reverting PR 1 restores `release.yml` wholesale.

## Open Questions

- Should the nightly also be published under a `nightly` dist-tag in addition to `latest`, so `npm i @taskless/cli-nightly@nightly` reads clearly even though it resolves the same version?
- Does the nightly need a README rewrite at pack time, or is the release README acceptable under a name it does not mention?
- When old-version cleanup is picked up separately, does it belong in `release-cli-nightly.yml` or in a scheduled workflow of its own?
