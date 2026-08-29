# Contributing

Thanks for working on Taskless.

This file sits outside every Vale scope in `.taskless/rules/vale/`, which is
deliberate. The `docs-npx-cli` rule rewrites `pnpm cli` and
`pnpm dlx @taskless/cli` to the published `npx @taskless/cli` form, at error
level, with a `raw` scope that reaches inside fenced code blocks and cannot be
suppressed with an in-file directive. That rule is right for a README, which is
read by people who do not have this repository checked out. It makes a
contributor guide impossible to write, because a contributor guide has to name
the local scripts. So this document is out of scope, and the rules stay strict
everywhere they apply.

## Using AI to contribute

We use coding agents here, and you are welcome to. Three things hold.

**You own what your agent does.** A pull request from your account is your pull
request. "The agent wrote it" is not a defect report, an excuse, or a
mitigation. Review the diff before you open it, the same way you would review
your own work before asking someone else to read it.

**You are expected to be able to explain what it does.** Not line by line, but
you should be able to say what the change does, why it is shaped that way, and
what you considered and rejected. If a reviewer asks why a function exists and
the honest answer is that the agent put it there, the change is not ready. This
is the practical test, and it is the one that matters: an agent will happily
produce a confident, plausible, wrong change, and the contributor is the only
person positioned to catch that before review.

**We are not running an attestation system, and we might.** There is no
[vouch](https://github.com/vouch-dev/vouch)-style signing or provenance
requirement on contributions today, and no plan to add one on a schedule. If the
volume or the risk changes, we are open to exploring it. Raise an issue if you
think we have reached that point.

Nothing here asks you to disclose that you used an agent. The standard is the
same whether you did or not.

## Local development

```bash
pnpm install
pnpm build      # dist/ is a build artifact; nothing rebuilds it for you
pnpm typecheck
pnpm lint
pnpm test
```

Run the locally built CLI with `pnpm cli`, which executes
`./packages/cli/dist/index.js`.

**`pnpm cli` runs the last build, not your working tree.** A stale `dist/`
serves stale behavior, including stale `agent <topic>` recipes, which are
embedded into the bundle at build time rather than fetched at runtime. Run
`pnpm build` first whenever the answer depends on current source. This has
bitten us: an agent followed a recipe from a `dist/` built 26 commits earlier
and authored four rules against a documented contract that had changed since.

OpenSpec runs through `pnpm openspec`. A bare `openspec` is not on `PATH` here.

## Nightlies

Work that has merged to `main` but is not yet released is published as
`@taskless/cli-nightly`, so unreleased behavior can be installed and exercised
without waiting for a release. Use one when you want to reproduce a report
against merged work, or check whether something is already fixed on `main`
without building the repository yourself.

**A nightly is also how you use this CLI from another repository.** To exercise
unreleased behavior somewhere other than this checkout, merge it to `main` and
install the nightly that follows.

```bash
npx @taskless/cli-nightly@latest --version
```

A few properties worth knowing before you rely on one:

- **The executable is `taskless`, the same as the release.** Every documented
  invocation, skill, and recipe works unchanged against a nightly.
- **Because the binary name is the same, a nightly and `@taskless/cli` collide
  when both are installed globally.** That is not a supported configuration. A
  nightly is a drop-in for the release it anticipates, not a companion to it.
  Use one or the other globally, or install the nightly into a project.
- **Versions look like `0.11.0-20260818123456x05b3c88`**: the release the
  nightly anticipates, the UTC build time, and the commit it was built from.
  Every one is a prerelease and the newest always carries the `latest` tag, so
  installing with no version gives you the most recent nightly.
- **A nightly is published on each push to `main` that has changesets pending**,
  from a commit that passed validation, and is the same build as the release it
  anticipates. When the Version Packages PR merges, the changesets are consumed
  and the real `@taskless/cli` release publishes instead.

### Testing against a nightly

Install it into a scratch project rather than globally, so it cannot collide
with a release you have installed:

```bash
mkdir /tmp/taskless-probe && cd /tmp/taskless-probe
npm init -y
npm install @taskless/cli-nightly@latest
npx taskless --version    # confirm the version you meant to test
npx taskless init
```

Two things that will confuse you if you do not know them.

**A nightly bakes its own invocation into everything it ships.** The build
rewrites `npx @taskless/cli` to `npx @taskless/cli-nightly@<version>` in every
skill, command, and recipe, so an agent reading them calls the nightly rather
than the released package. That is intended. If you are comparing a nightly's
generated content against a release's, the invocation string differing is not
the bug you are looking for.

**Agents working in this repository cannot run a nightly.** `.claude/settings.json`
denies `Bash(npx:*)` and `Bash(pnpm dlx @taskless/cli*)`. That is deliberate: an
agent reaching for a published package is usually about to test something other
than the tree it is working in. Build and use `pnpm cli` instead, which is the
only path that reflects uncommitted work.

## Pull requests

Read `CLAUDE.md` for the repository's working agreements. The parts that most
often trip people up:

- **Commits are GPG-signed.** `git commit -S`. Note that `main` itself shows
  unsigned commits, because GitHub re-signs nothing when it rebases. A commit
  reading `N` before it reaches `main` is a real problem; one on `main` is not.
- **Rebase is the only merge method.** Squash and merge commits are disabled.
- **Ship a changeset** when the change has a release note, on the bottom branch
  if you are stacking. The check warns and never fails, because whether a change
  ships a release note is a judgement call.
- **Prefer stacking**, and aim to keep a hand-written diff under roughly 1200
  lines. A pull request far past that does not get reviewed, it gets approved.

## Code style

`.conventions/STYLEGUIDE-CODE.md` and `.conventions/STYLEGUIDE-UI.md` are
enforced, and `CLAUDE.md` points every agent at them. The house rules with the
sharpest edges are direct imports over barrel files, library types over
hand-written duplicates, and verifying build output in the build rather than by
parsing it afterwards.
