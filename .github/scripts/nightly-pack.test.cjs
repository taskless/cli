// SPDX-License-Identifier: MIT
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const {
  NIGHTLY_PACKAGE,
  SOURCE_PACKAGE,
  applyNightlyIdentity,
  buildNightlyVersion,
  formatStampTimestamp,
  hasNightlyForSha,
  isValidVersion,
  selectProposedVersion,
  buildNightlyReadme,
} = require("./nightly-pack.cjs");

/** The CLI manifest as committed, so these tests fail if it drifts out of shape. */
const COMMITTED_CLI_MANIFEST = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "packages", "cli", "package.json"),
    "utf8"
  )
);

const DATE = "2026-08-18T12:34:56.000Z";

test("formatStampTimestamp renders 14 UTC digits", () => {
  assert.equal(formatStampTimestamp(DATE), "20260818123456");
  assert.equal(formatStampTimestamp("2026-01-02T03:04:05Z"), "20260102030405");
  assert.throws(() => formatStampTimestamp("not a date"), /not a usable date/);
});

test("buildNightlyVersion stamps <n.m.k>-<timestamp>x<sha>", () => {
  assert.equal(
    buildNightlyVersion({
      baseVersion: "0.11.0",
      date: DATE,
      shortSha: "05b3c88",
    }),
    "0.11.0-20260818123456x05b3c88"
  );
});

// The `x` separator, and the two ways removing it breaks. Both alternatives are
// checked against the same semver grammar the stamper asserts with, so this
// test states exactly what the separator buys rather than asserting it exists.
test("an all-digit sha beginning with 0 still yields a valid semantic version", () => {
  const version = buildNightlyVersion({
    baseVersion: "0.11.0",
    date: DATE,
    shortSha: "0123456",
  });
  assert.equal(version, "0.11.0-20260818123456x0123456");
  assert.ok(isValidVersion(version), `${version} must be a valid semver`);

  // A dot would start a second prerelease identifier, making `0123456` a
  // numeric identifier with a leading zero — which semver forbids outright.
  assert.equal(isValidVersion("0.11.0-20260818123456.0123456"), false);

  // A bare concatenation stays valid, but becomes one 21-digit NUMERIC
  // identifier: semver compares those numerically, and 21 digits is past exact
  // double precision, so chronological ordering silently stops being reliable.
  assert.ok(isValidVersion("0.11.0-202608181234560123456"));
  // Two distinct 21-digit identifiers that a numeric comparison cannot tell
  // apart, because both collapse onto the same double:
  assert.equal(
    Number("202608181234560123456") === Number("202608181234560123457"),
    true
  );
});

test("nightlies of one base version sort chronologically by string comparison", () => {
  const earlier = buildNightlyVersion({
    baseVersion: "0.11.0",
    date: "2026-08-18T12:34:56Z",
    shortSha: "ffffff0",
  });
  const later = buildNightlyVersion({
    baseVersion: "0.11.0",
    date: "2026-08-19T00:00:00Z",
    shortSha: "0000001",
  });
  assert.ok(earlier < later, `${earlier} must sort before ${later}`);
});

test("buildNightlyVersion refuses input it cannot stamp correctly", () => {
  assert.throws(
    () =>
      buildNightlyVersion({
        baseVersion: "0.11.0-20260818123456x05b3c88",
        date: DATE,
        shortSha: "05b3c88",
      }),
    /not major\.minor\.patch/,
    "an already-stamped version must not be stamped twice"
  );
  assert.throws(
    () =>
      buildNightlyVersion({
        baseVersion: "0.11.0",
        date: DATE,
        shortSha: "zz",
      }),
    /not an abbreviated commit hash/
  );
});

test("selectProposedVersion matches the CLI by name, never by position", () => {
  const status = {
    changesets: [{ id: "wild-jars-repeat", releases: [], summary: "…" }],
    releases: [
      {
        name: "@taskless/some-other-package",
        type: "major",
        oldVersion: "1.0.0",
        changesets: ["wild-jars-repeat"],
        newVersion: "2.0.0",
      },
      {
        name: SOURCE_PACKAGE,
        type: "minor",
        oldVersion: "0.10.2",
        changesets: ["wild-jars-repeat"],
        newVersion: "0.11.0",
      },
    ],
  };
  assert.equal(selectProposedVersion(status), "0.11.0");
});

test("selectProposedVersion fails loudly on a shape it does not recognize", () => {
  // The pre-measurement guess: an array at the root rather than an object.
  assert.throws(
    () =>
      selectProposedVersion([{ name: SOURCE_PACKAGE, newVersion: "0.11.0" }]),
    /no `releases` array/
  );
  assert.throws(
    () => selectProposedVersion({ releases: [] }),
    /proposes no release for @taskless\/cli/
  );
  assert.throws(
    () =>
      selectProposedVersion({
        releases: [{ name: SOURCE_PACKAGE, newVersion: "0.11" }],
      }),
    /not major\.minor\.patch/
  );
});

test("applyNightlyIdentity renames and restamps, and changes nothing else", () => {
  const nightly = applyNightlyIdentity(
    COMMITTED_CLI_MANIFEST,
    "0.11.0-20260818123456x05b3c88"
  );

  assert.equal(nightly.name, NIGHTLY_PACKAGE);
  assert.equal(nightly.version, "0.11.0-20260818123456x05b3c88");

  // A nightly is a drop-in: same executable name, same pinned platform deps.
  assert.deepEqual(nightly.bin, COMMITTED_CLI_MANIFEST.bin);
  assert.deepEqual(nightly.bin, { taskless: "./dist/index.js" });
  assert.deepEqual(
    nightly.optionalDependencies,
    COMMITTED_CLI_MANIFEST.optionalDependencies
  );
  assert.deepEqual(nightly.dependencies, COMMITTED_CLI_MANIFEST.dependencies);
  assert.deepEqual(nightly.files, COMMITTED_CLI_MANIFEST.files);
  assert.deepEqual(nightly.exports, COMMITTED_CLI_MANIFEST.exports);

  // Every key survives, and the input object is not mutated.
  assert.deepEqual(
    Object.keys(nightly).sort(),
    Object.keys(COMMITTED_CLI_MANIFEST).sort()
  );
  assert.equal(COMMITTED_CLI_MANIFEST.name, SOURCE_PACKAGE);
});

test("hasNightlyForSha matches on the trailing x<sha>", () => {
  const versions = [
    "0.11.0-20260818123456x05b3c88",
    "0.11.0-20260819010203xdeadbee",
  ];
  assert.equal(hasNightlyForSha(versions, "05b3c88"), true);
  assert.equal(hasNightlyForSha(versions, "DEADBEE"), true);
  assert.equal(hasNightlyForSha(versions, "0123456"), false);

  // `npm view <pkg> versions --json` yields a bare STRING when exactly one
  // version is published — which this package is, once, right after its
  // bootstrap publish.
  assert.equal(
    hasNightlyForSha("0.11.0-20260818123456x05b3c88", "05b3c88"),
    true
  );

  // A 404 (no such package) reaches the gate as an empty list, not a crash.
  assert.equal(hasNightlyForSha([], "05b3c88"), false);

  // A sha is a prefix of a longer one only in the argument, never in the match:
  // the version's identifier ends at the sha, so no partial match can occur.
  assert.equal(
    hasNightlyForSha(["0.11.0-20260818123456x05b3c880"], "05b3c88"),
    false
  );
});

test("the nightly ships its own README, not the CLI's", () => {
  const version = "0.11.0-20260818123456x05b3c88";
  const readme = buildNightlyReadme(version);

  // It has to name itself, or the package page reads as documentation for a
  // package the reader did not install.
  assert.match(readme, /^# @taskless\/cli-nightly/);
  // And it has to point somewhere useful rather than restating the docs.
  assert.match(readme, /npmjs\.com\/package\/@taskless\/cli/);
  assert.ok(readme.includes(version), "names the build it describes");
  // The collision is the one thing a reader can get wrong destructively.
  assert.match(readme, /[Dd]o not install both globally/);
});
