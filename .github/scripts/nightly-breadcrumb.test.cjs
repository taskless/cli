// SPDX-License-Identifier: MIT
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  NIGHTLY_PACKAGE,
  VERSION_PR_BRANCH,
  hasRegion,
  isNewerBuild,
  parseArguments,
  readRegionVersion,
  parseStampedVersion,
  renderRegion,
  selectVersionPullRequest,
  stripRegion,
  upsertRegion,
} = require("./nightly-breadcrumb.cjs");

const VERSION = "0.11.0-20260818123456x05b3c88";
const NEXT_VERSION = "0.11.0-20260819080102xabc1234";

/** A stack-breadcrumb region, as stack-breadcrumb.yml writes it. */
const STACK_REGION = [
  "<!-- stack root=71 pr=71,93:71 -->",
  "**Stack** (root → tip):",
  "",
  "- #71",
  "  - ➡️ #93 (you are here)",
  "<!-- /stack -->",
].join("\n");

const DESCRIPTION =
  "# Releases\n\n## @taskless/cli@0.11.0\n\n### Minor Changes";

test("parseStampedVersion reads the commit time and sha back out of the version", () => {
  assert.deepEqual(parseStampedVersion(VERSION), {
    committedAt: "2026-08-18 12:34:56",
    shortSha: "05b3c88",
    // The raw stamp is kept so builds can be ordered without re-parsing.
    stamp: "20260818123456",
  });
});

// Nothing here may consult a clock: the version is stamped once per run and
// every fact in the region has to agree with it.
test("parseStampedVersion refuses a version that is not stamped", () => {
  for (const version of ["0.11.0", "0.11.0-beta.1", "", undefined]) {
    assert.throws(
      () => parseStampedVersion(version),
      /not a stamped nightly version/
    );
  }
});

test("renderRegion names the package that is actually published", () => {
  const region = renderRegion(VERSION);
  assert.equal(
    region,
    [
      "<!-- nightly -->",
      "### Build Info",
      "`npx @taskless/cli-nightly@0.11.0-20260818123456x05b3c88`",
      "",
      "**Built from:** 05b3c88",
      "**Committed at:** 2026-08-18 12:34:56",
      "<!-- /nightly -->",
    ].join("\n")
  );
  // The nightly is published as @taskless/cli-nightly; an install line naming
  // @taskless/cli would send a reviewer to the last RELEASE instead of to this
  // build.
  assert.match(region, /npx @taskless\/cli-nightly@/);
  assert.equal(NIGHTLY_PACKAGE, "@taskless/cli-nightly");
});

test("upsertRegion puts the region at the top when none is present", () => {
  const body = upsertRegion(DESCRIPTION, VERSION);
  assert.ok(body.startsWith("<!-- nightly -->"));
  assert.ok(body.endsWith(DESCRIPTION));
  assert.equal(body, `${renderRegion(VERSION)}\n\n${DESCRIPTION}`);
});

test("upsertRegion writes into an empty body without leading blank lines", () => {
  assert.equal(upsertRegion("", VERSION), renderRegion(VERSION));
  assert.equal(upsertRegion(undefined, VERSION), renderRegion(VERSION));
});

// The failure this exists to prevent: a nightly publishes every push, so a
// region that were appended rather than replaced would grow one block per day.
test("repeated publishes replace the region, never accumulate", () => {
  let body = upsertRegion(DESCRIPTION, VERSION);
  body = upsertRegion(body, NEXT_VERSION);
  body = upsertRegion(body, NEXT_VERSION);
  assert.equal(body.match(/<!-- nightly -->/g).length, 1);
  assert.equal(body.match(/<!-- \/nightly -->/g).length, 1);
  assert.equal(body, `${renderRegion(NEXT_VERSION)}\n\n${DESCRIPTION}`);
  assert.ok(!body.includes(VERSION));
});

test("upsertRegion is idempotent for one version", () => {
  const once = upsertRegion(DESCRIPTION, VERSION);
  assert.equal(upsertRegion(once, VERSION), once);
  assert.equal(upsertRegion(upsertRegion(once, VERSION), VERSION), once);
});

test("a manually deleted region is re-attached at the top", () => {
  const withRegion = upsertRegion(DESCRIPTION, VERSION);
  // What a human does: select the block, delete it, save.
  const deleted = withRegion.replace(renderRegion(VERSION), "").trimStart();
  assert.ok(!hasRegion(deleted));
  assert.equal(upsertRegion(deleted, VERSION), withRegion);
});

// stack-breadcrumb.yml maintains its own region on the same bodies. Neither
// pattern may match the other's markers, and the region must land directly
// below a leading stack region — where stack-breadcrumb.cjs's canonicalizeBody
// leaves it — so the two writers never move each other's work.
test("the stack-breadcrumb region is left byte-for-byte alone", () => {
  const body = `${STACK_REGION}\n\n${DESCRIPTION}`;
  const annotated = upsertRegion(body, VERSION);

  assert.ok(annotated.includes(STACK_REGION));
  assert.equal(
    annotated.match(/<!-- stack root=71 pr=71,93:71 -->/g).length,
    1
  );
  assert.equal(annotated.match(/<!-- \/stack -->/g).length, 1);
  assert.equal(
    annotated,
    `${STACK_REGION}\n\n${renderRegion(VERSION)}\n\n${DESCRIPTION}`
  );

  // And a second publish still only touches the nightly region.
  const republished = upsertRegion(annotated, NEXT_VERSION);
  assert.equal(
    republished,
    `${STACK_REGION}\n\n${renderRegion(NEXT_VERSION)}\n\n${DESCRIPTION}`
  );
});

test("a region above the stack region is moved below it", () => {
  const body = `${renderRegion(VERSION)}\n\n${STACK_REGION}\n\n${DESCRIPTION}`;
  assert.equal(
    upsertRegion(body, NEXT_VERSION),
    `${STACK_REGION}\n\n${renderRegion(NEXT_VERSION)}\n\n${DESCRIPTION}`
  );
});

// The layout above is only stable if stack-breadcrumb.cjs re-lays the body to
// the same string. If it did not, the two writers would move the region back
// and forth on every run.
test("stack-breadcrumb's canonicalizeBody keeps the region where it is", () => {
  const { canonicalizeBody } = require("./stack-breadcrumb.cjs");
  const annotated = upsertRegion(`${STACK_REGION}\n\n${DESCRIPTION}`, VERSION);
  assert.equal(canonicalizeBody(annotated, STACK_REGION), annotated);
  assert.equal(upsertRegion(annotated, VERSION), annotated);
});

test("a stack region that is not leading does not move the region", () => {
  const body = `${DESCRIPTION}\n\n${STACK_REGION}`;
  assert.equal(
    upsertRegion(body, VERSION),
    `${renderRegion(VERSION)}\n\n${body}`
  );
});

test("a stack region containing the word nightly is not mistaken for one", () => {
  const body = [
    "<!-- stack root=71 pr=71 -->",
    "**Stack** (root → tip):",
    "",
    "- #71 nightly breadcrumbs",
    "<!-- /stack -->",
  ].join("\n");
  assert.ok(!hasRegion(body));
  assert.equal(stripRegion(body), body);
});

// If a body's region is moved into the middle (a human editing around it), the
// next publish must not leave it there — "always at the top" is the contract.
test("a region sitting mid-body is moved to the top, not duplicated", () => {
  const body = `above\n\n${renderRegion(VERSION)}\n\nbelow`;
  const annotated = upsertRegion(body, NEXT_VERSION);
  assert.equal(annotated, `${renderRegion(NEXT_VERSION)}\n\nabove\n\nbelow`);
  assert.equal(annotated.match(/<!-- nightly -->/g).length, 1);
});

// Copilot review on #133: normalization must be scoped to the seam the removal
// leaves, not applied to the whole body. Blank lines the author put somewhere
// else are content, and a republish must not rewrite them.
test("blank lines elsewhere in the description survive a republish", () => {
  const authored = [
    "# Releases",
    "",
    "",
    "",
    "Deliberate breathing room above this line.",
    "",
    "",
    "And below it.",
  ].join("\n");

  const once = upsertRegion(authored, VERSION);
  assert.equal(once, `${renderRegion(VERSION)}\n\n${authored}`);

  // The republish is the dangerous one: it strips the region it wrote last
  // time, which is when a body-wide collapse would fire.
  const twice = upsertRegion(once, NEXT_VERSION);
  assert.equal(twice, `${renderRegion(NEXT_VERSION)}\n\n${authored}`);
  assert.ok(twice.endsWith(authored));
  assert.equal(stripRegion(twice), authored);
});

test("the seam left by a mid-body region becomes exactly one blank line", () => {
  const body = `above\n\n${renderRegion(VERSION)}\n\nbelow`;
  assert.equal(stripRegion(body), "above\n\nbelow");
});

test("stripRegion returns a region-free body byte-for-byte", () => {
  // Deliberately whitespace-heavy: a run that has nothing to remove must not
  // reflow prose, and an indented code block must survive.
  const body = "    const x = 1;\n\n\n\nstill mine   ";
  assert.equal(stripRegion(body), body.trimEnd());
});

/** The shape the pulls endpoint returns, trimmed to what the selector reads. */
const pull = (number, ref, base = "main") => ({
  number,
  state: "open",
  head: { ref },
  base: { ref: base },
  body: "",
});

test("selectVersionPullRequest finds the open Version Packages pull request", () => {
  const pulls = [pull(12, "feat/other"), pull(74, VERSION_PR_BRANCH)];
  assert.equal(selectVersionPullRequest(pulls).number, 74);
});

// claude[bot] review on #133: GitHub allows several open PRs from one head
// branch to different bases, so matching the head alone can annotate the wrong
// one — whichever the API happened to list first.
test("a same-head pull request targeting another base is not selected", () => {
  const decoy = pull(90, VERSION_PR_BRANCH, "some/test-base");
  const real = pull(74, VERSION_PR_BRANCH);

  // Listed FIRST, so a head-only `.find()` would return it.
  assert.equal(selectVersionPullRequest([decoy, real]).number, 74);
  assert.equal(selectVersionPullRequest([decoy]), undefined);
});

test("a pull request with no base is not selected", () => {
  assert.equal(
    selectVersionPullRequest([
      { number: 74, state: "open", head: { ref: VERSION_PR_BRANCH } },
    ]),
    undefined
  );
});

test("readRegionVersion reads back the version a publish wrote", () => {
  assert.equal(readRegionVersion(upsertRegion(DESCRIPTION, VERSION)), VERSION);
  assert.equal(readRegionVersion(DESCRIPTION), undefined);
  assert.equal(readRegionVersion(""), undefined);
});

// The cross-run race: `needs:` orders jobs inside ONE run, and this workflow
// has no concurrency group on purpose, so an older run's breadcrumb job can
// reach the write after a newer one did.
test("isNewerBuild keeps the write monotonic", () => {
  assert.equal(isNewerBuild(NEXT_VERSION, VERSION), true);
  assert.equal(isNewerBuild(VERSION, NEXT_VERSION), false);
  assert.equal(isNewerBuild(VERSION, VERSION), false);
  assert.equal(isNewerBuild(VERSION, undefined), true);
  // A base-version bump does not reorder builds: the stamp decides.
  assert.equal(isNewerBuild("0.12.0-20260817000000xaaaaaaa", VERSION), false);
  // A region edited past recognition is treated as absent and rewritten.
  assert.equal(isNewerBuild(VERSION, "hand-edited"), true);
});

// The whole point of the "no open pull request" branch: it is a normal state,
// and a cosmetic breadcrumb must never fail a run that already published.
test("no Version Packages pull request is undefined, not an error", () => {
  assert.equal(selectVersionPullRequest([]), undefined);
  assert.equal(
    selectVersionPullRequest([
      { number: 12, state: "open", head: { ref: "feat/other" } },
    ]),
    undefined
  );
});

// A malformed response is NOT the same as an empty one — collapsing the two is
// exactly the fail-open this file must not have.
test("a pulls response that is not an array throws", () => {
  assert.throws(
    () => selectVersionPullRequest({ message: "Not Found" }),
    /not an array/
  );
  assert.throws(() => selectVersionPullRequest(undefined), /not an array/);
});

test("parseArguments requires all three flags", () => {
  assert.deepEqual(
    parseArguments([
      "--version",
      VERSION,
      "--pulls",
      "/tmp/pulls.json",
      "--out",
      "/tmp/body.md",
    ]),
    { version: VERSION, pulls: "/tmp/pulls.json", out: "/tmp/body.md" }
  );
  assert.throws(
    () => parseArguments(["--version", VERSION]),
    /--pulls is required/
  );
  assert.throws(() => parseArguments(["--nope"]), /unknown argument/);
  assert.throws(() => parseArguments(["--version"]), /--version requires/);
});
