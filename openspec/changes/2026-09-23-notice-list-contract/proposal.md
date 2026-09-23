## Why

taskless/cli#390 asked for four duplicated notice joiners to become one helper.
The duplication was never the problem. The problem is that "one notice per
line" was an agreement between four producers and two renderers that existed
only as four string literals nobody was obliged to keep identical — and one of
them already did not, joining with a space.

Nine spec files mention "notice", every one of them about **whether** a notice
surfaces. Nothing standing says how several notices are separated, how they are
rendered, or what a machine consumer receives. So a producer could switch
separator, or a renderer stop prefixing, and no requirement would be violated.

That is not hypothetical. `check` shipped the defect: it printed `Notice: `
once per element while producers glued several advisories into one element, so
a run with two advisories printed the first behind a marker and the second as
an unlabelled stray line. `verify` had the same bug and it was fixed in
`241e1c4`; nothing recorded the fix as a requirement, so `check` kept it.

The behaviour is now a list — one notice per element, all the way from the
producers to the published envelope — and these deltas say so, in the three
capabilities that own the producers and the renderers.

## What Changes

- **`cli-check`** — a new requirement: `check` renders one marker per notice
  and prefixes every line of one, and `--json` publishes `notices` as a flat
  list in which one element is one notice.
- **`cli-rule-validation`** — a new requirement: `verify` and `test` carry
  notices as a list, render one `notice:` marker per element, and publish
  `notices` in `--json`, replacing the joined `notice` string.
- **`cli-vale-rule-engine`** — a new requirement: when the Vale engine has
  several independent things to say about one run, each is a distinct notice
  rather than being folded into one.

All three are ADDED. Nothing standing describes this, so there is no
requirement to restate, and a MODIFIED block would risk dropping scenarios from
requirements that are about a different question entirely.

## Capabilities

### New Capabilities

None. Three existing capabilities gain a requirement each.

### Modified Capabilities

- `cli-check`: gains "Notices render one marker per notice and publish as a
  flat list".
- `cli-rule-validation`: gains "Verify and test carry notices as a list".
- `cli-vale-rule-engine`: gains "Independent Vale advisories stay separate
  notices".

## Impact

The published `notice?: string` field becomes `notices: string[]` in
`verifyOutputSchema.schema`, `valeVerifyOutputSchema`, and the `verify`/`test`
envelope. It was replaced rather than mirrored: a joined `notice` kept beside
the list would preserve the separator convention this change exists to remove,
and a consumer could not safely split it apart in the first place, since
nothing published the separator. `check --json`'s `notices` keeps its name and
its `string[]` type; only its element boundaries change.

The bump is `patch`. The package is `0.11.2`, pre-1.0, where semver puts the
public API outside the stability guarantee — the changeset body says what a
consumer crosses.

## Delivery shape

**Single PR.** The helper, the structural change, the renderer fix, the tests
and these deltas are one reviewable diff, and splitting them would land a spec
describing behaviour that is not yet there, or a renderer fix without the
requirement that keeps it fixed. This PR is the tip, so the change is archived
here.
