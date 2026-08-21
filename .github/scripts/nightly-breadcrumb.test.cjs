// SPDX-License-Identifier: MIT
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  NIGHTLY_PACKAGE,
  VERSION_PR_BRANCH,
  hasRegion,
  parseArguments,
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

test("parseStampedVersion reads the build time and sha back out of the version", () => {
  assert.deepEqual(parseStampedVersion(VERSION), {
    builtAt: "2026-08-18 12:34:56",
    shortSha: "05b3c88",
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
      "**Built at:** 2026-08-18 12:34:56",
      "<!-- /nightly -->",
    ].join("\n")
  );
  // The nightly is published as @taskless/cli-nightly; an install line naming
  // @taskless/cli would send a reviewer to the last RELEASE instead of to this
  // build.
  assert.match(region, /npx @taskless\/cli-nightly@/);
  assert.equal(NIGHTLY_PACKAGE, "@taskless/cli-nightly");
});

test("upsertRegion appends at the end when no region is present", () => {
  const body = upsertRegion(DESCRIPTION, VERSION);
  assert.ok(body.startsWith(DESCRIPTION));
  assert.ok(body.endsWith("<!-- /nightly -->"));
  assert.equal(body, `${DESCRIPTION}\n\n${renderRegion(VERSION)}`);
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
  assert.equal(body, `${DESCRIPTION}\n\n${renderRegion(NEXT_VERSION)}`);
  assert.ok(!body.includes(VERSION));
});

test("upsertRegion is idempotent for one version", () => {
  const once = upsertRegion(DESCRIPTION, VERSION);
  assert.equal(upsertRegion(once, VERSION), once);
  assert.equal(upsertRegion(upsertRegion(once, VERSION), VERSION), once);
});

test("a manually deleted region is re-attached at the end", () => {
  const withRegion = upsertRegion(DESCRIPTION, VERSION);
  // What a human does: select the block, delete it, save.
  const deleted = withRegion.replace(renderRegion(VERSION), "").trimEnd();
  assert.ok(!hasRegion(deleted));
  assert.equal(upsertRegion(deleted, VERSION), withRegion);
});

// stack-breadcrumb.yml maintains its own region on the same bodies. Neither
// pattern may match the other's markers, and the region must land after
// whatever else is there — always at the end.
test("the stack-breadcrumb region is left byte-for-byte alone", () => {
  const body = `${STACK_REGION}\n\n${DESCRIPTION}`;
  const annotated = upsertRegion(body, VERSION);

  assert.ok(annotated.includes(STACK_REGION));
  assert.equal(
    annotated.match(/<!-- stack root=71 pr=71,93:71 -->/g).length,
    1
  );
  assert.equal(annotated.match(/<!-- \/stack -->/g).length, 1);
  assert.equal(annotated, `${body}\n\n${renderRegion(VERSION)}`);

  // And a second publish still only touches the nightly region.
  const republished = upsertRegion(annotated, NEXT_VERSION);
  assert.equal(republished, `${body}\n\n${renderRegion(NEXT_VERSION)}`);
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
// next publish must not leave it there — "always at the end" is the contract.
test("a region sitting mid-body is moved to the end, not duplicated", () => {
  const body = `${renderRegion(VERSION)}\n\n${DESCRIPTION}`;
  const annotated = upsertRegion(body, NEXT_VERSION);
  assert.equal(annotated, `${DESCRIPTION}\n\n${renderRegion(NEXT_VERSION)}`);
  assert.equal(annotated.match(/<!-- nightly -->/g).length, 1);
});

test("stripRegion returns a region-free body byte-for-byte", () => {
  // Deliberately whitespace-heavy: a run that has nothing to remove must not
  // reflow prose, and an indented code block must survive.
  const body = "    const x = 1;\n\n\n\nstill mine   ";
  assert.equal(stripRegion(body), body.trimEnd());
});

test("selectVersionPullRequest finds the open Version Packages pull request", () => {
  const pulls = [
    { number: 12, state: "open", head: { ref: "feat/other" }, body: "" },
    { number: 74, state: "open", head: { ref: VERSION_PR_BRANCH }, body: "hi" },
  ];
  assert.equal(selectVersionPullRequest(pulls).number, 74);
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
