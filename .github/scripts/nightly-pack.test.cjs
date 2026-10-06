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
  hasNewerNightly,
  hasNightlyForSha,
  isValidVersion,
  parseArguments,
  parseVersionsResponse,
  selectPackedFilename,
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

// The two modes, and the one property that matters between them: the version is
// stamped ONCE (--print-version) and handed to both the CLI build and the pack.
// If the pack could stamp its own, the two would read different clocks, and the
// skills shipped inside the tarball would name a version that was never
// published.
test("packing takes a version and cannot compute one", () => {
  const options = parseArguments([
    "--version",
    "0.11.0-20260818123456x05b3c88",
    "--out",
    ".nightly-dist",
  ]);
  assert.equal(options.printVersion, false);
  assert.equal(options.version, "0.11.0-20260818123456x05b3c88");

  // The inputs a version could be recomputed from are rejected outright, rather
  // than accepted-and-ignored.
  assert.throws(
    () =>
      parseArguments([
        "--version",
        "0.11.0-20260818123456x05b3c88",
        "--sha",
        "05b3c88",
      ]),
    /only for --print-version/
  );
  assert.throws(
    () =>
      parseArguments([
        "--version",
        "0.11.0-20260818123456x05b3c88",
        "--date",
        DATE,
      ]),
    /only for --print-version/
  );
  assert.throws(
    () =>
      parseArguments([
        "--version",
        "0.11.0-20260818123456x05b3c88",
        "--status",
        "nightly-status.json",
      ]),
    /only for --print-version/
  );

  // And packing without one is an error, never a stamped-on-the-spot fallback.
  assert.throws(() => parseArguments(["--out", ".nightly-dist"]), /--version/);
  assert.throws(
    () => parseArguments(["--version", "not-a-version"]),
    /not a valid semantic version/
  );
});

test("--print-version stamps from the status file, the sha, and the commit date", () => {
  const options = parseArguments([
    "--print-version",
    "--status",
    "nightly-status.json",
    "--sha",
    "05b3c88",
    "--date",
    "2026-08-18T12:34:56+00:00",
  ]);
  assert.equal(options.printVersion, true);
  assert.equal(options.sha, "05b3c88");
  assert.equal(options.date, "2026-08-18T12:34:56+00:00");
  assert.match(options.status, /nightly-status\.json$/);

  assert.throws(
    () =>
      parseArguments(["--print-version", "--sha", "05b3c88", "--date", DATE]),
    /--status is required/
  );
  assert.throws(
    () =>
      parseArguments(["--print-version", "--status", "s.json", "--date", DATE]),
    /--sha is required/
  );
  // No clock fallback: a missing date is an error, because a stamp read after
  // the environment wait is exactly what lets a stalled run outrank a newer one.
  assert.throws(
    () =>
      parseArguments([
        "--print-version",
        "--status",
        "s.json",
        "--sha",
        "05b3c88",
      ]),
    /--date is required/
  );
  assert.throws(
    () =>
      parseArguments([
        "--print-version",
        "--status",
        "s.json",
        "--sha",
        "05b3c88",
        "--date",
        "yesterday-ish",
      ]),
    /not a usable date/
  );
  assert.throws(
    () =>
      parseArguments([
        "--print-version",
        "--status",
        "s.json",
        "--sha",
        "05b3c88",
        "--version",
        "0.11.0-20260818123456x05b3c88",
      ]),
    /not accepted with --print-version/
  );
});

// `git log --format=%cI` prints the committer's local offset, not UTC. The stamp
// must normalize it, or two commits a few minutes apart from different
// timezones would sort by wall-clock digits instead of by when they landed.
test("formatStampTimestamp normalizes an offset commit date to UTC", () => {
  assert.equal(
    formatStampTimestamp("2026-10-06T11:23:45-07:00"),
    "20261006182345"
  );
});

// The superseded check (#474): a publish released late from an environment
// wait must not take `latest` from a newer commit's nightly.
test("hasNewerNightly is true only when a later commit already published", () => {
  const older = "0.12.0-20261006182345xe8b2153";
  const newer = "0.12.0-20261006183653xde43cf6";
  assert.equal(hasNewerNightly([older, newer], older), true);
  assert.equal(hasNewerNightly([older], newer), false);
  assert.equal(hasNewerNightly([], older), false);
  // `npm view --json` returns a bare string for a package with one version.
  assert.equal(hasNewerNightly(newer, older), true);
});

test("hasNewerNightly orders by timestamp, never by base version", () => {
  // A changeset was removed, so the newer commit proposes a LOWER base. Semver
  // would rank it below the older nightly; the commit order says otherwise.
  const olderMinor = "0.12.0-20261006182345xe8b2153";
  const newerPatch = "0.11.1-20261006183653xde43cf6";
  assert.equal(hasNewerNightly([newerPatch], olderMinor), true);
  assert.equal(hasNewerNightly([olderMinor], newerPatch), false);
});

test("hasNewerNightly treats an equal stamp as not newer", () => {
  // A re-run of the same commit — the exact-version guard handles that one.
  const version = "0.12.0-20261006182345xe8b2153";
  assert.equal(hasNewerNightly([version], version), false);
  // Two commits landed in the same second: neither supersedes the other.
  assert.equal(
    hasNewerNightly(["0.12.0-20261006182345xabcdef0"], version),
    false
  );
});

test("hasNewerNightly refuses a version it cannot read", () => {
  assert.throws(
    () => hasNewerNightly(["0.12.0"], "0.12.0-20261006182345xe8b2153"),
    /not a stamped nightly version/
  );
  assert.throws(
    () => hasNewerNightly([], "0.12.0"),
    /not a stamped nightly version/
  );
});

// Fails CLOSED. The three outcomes are distinct, and "could not tell" is not
// "nothing published" — read as empty, the superseded check would let an older
// commit publish over a newer one and take `latest`, successfully and silently.
test("parseVersionsResponse separates found, not-found, and unreadable", () => {
  // exit 0, a list — the ordinary case.
  assert.deepEqual(
    parseVersionsResponse('["0.11.0-20260818123456x05b3c88"]', 0),
    ["0.11.0-20260818123456x05b3c88"]
  );

  // exit 0, a bare STRING — what `--json` yields for a package with exactly one
  // version, which this package is right after its bootstrap publish.
  assert.deepEqual(
    parseVersionsResponse('"0.11.0-20260818123456x05b3c88"', 0),
    ["0.11.0-20260818123456x05b3c88"]
  );

  // The one legitimate non-zero exit: the package does not exist yet. npm
  // prints this object to STDOUT and exits 1 (measured against a real 404).
  assert.deepEqual(
    parseVersionsResponse(
      JSON.stringify({
        error: {
          code: "E404",
          summary:
            "Not Found - GET https://registry.npmjs.org/@taskless%2fcli-nightly",
        },
      }),
      1
    ),
    []
  );

  // Everything else raises rather than reporting an empty list.
  assert.throws(
    () => parseVersionsResponse("<html>502 Bad Gateway</html>", 0),
    /did not return JSON/,
    "non-JSON output must not read as no versions"
  );
  assert.throws(
    () => parseVersionsResponse('["0.11.0-2026', 0),
    /did not return JSON/,
    "truncated output must not read as no versions"
  );
  assert.throws(
    () => parseVersionsResponse("", 0),
    /neither a version list nor a version/,
    "an empty body must not read as no versions"
  );
  assert.throws(
    () =>
      parseVersionsResponse(
        JSON.stringify({ error: { code: "EAI_AGAIN" } }),
        1
      ),
    /no E404/,
    "a network failure must not read as no versions"
  );
  assert.throws(
    () => parseVersionsResponse("", 1),
    /no E404/,
    "a bare non-zero exit must not read as no versions"
  );
});

// npm 12 changed `npm pack --json` from an array to an object keyed by package
// name. Destructuring the object as an array threw `object is not iterable`
// after a SUCCESSFUL pack, one step short of publishing, on the first nightly
// built after the npm pin moved to 12.0.1. The two payloads below are the
// shapes npm 11.9.0 and npm 12.0.1 were measured printing for the same
// manifest, reduced to the fields this function reads.
test("selectPackedFilename reads both shapes npm emits", () => {
  const entry = {
    id: "@taskless/cli-nightly@0.11.0-20260818123456x05b3c88",
    name: "@taskless/cli-nightly",
    version: "0.11.0-20260818123456x05b3c88",
    filename: "taskless-cli-nightly-0.11.0-20260818123456x05b3c88.tgz",
  };

  // npm <= 11: an array of pack results.
  assert.equal(
    selectPackedFilename(JSON.stringify([entry])),
    "taskless-cli-nightly-0.11.0-20260818123456x05b3c88.tgz"
  );

  // npm 12: the same results, keyed by package name.
  assert.equal(
    selectPackedFilename(JSON.stringify({ [entry.name]: entry })),
    "taskless-cli-nightly-0.11.0-20260818123456x05b3c88.tgz"
  );
});

// The tarball this returns is the one that gets published, so every shape it
// cannot read must raise. Returning undefined would build `<out>/undefined`
// and fail somewhere further away, or publish something unintended.
test("selectPackedFilename refuses anything it cannot read as one tarball", () => {
  assert.throws(
    () => selectPackedFilename("npm error code E404"),
    /did not return JSON/
  );
  assert.throws(() => selectPackedFilename(""), /did not return JSON/);
  assert.throws(
    () => selectPackedFilename("[]"),
    /reported 0 tarballs/,
    "an empty result is not a tarball to publish"
  );
  assert.throws(
    () =>
      selectPackedFilename(
        JSON.stringify([{ filename: "a.tgz" }, { filename: "b.tgz" }])
      ),
    /reported 2 tarballs/,
    "picking the first of several would publish an arbitrary one"
  );
  assert.throws(
    () =>
      selectPackedFilename(JSON.stringify([{ name: "@taskless/cli-nightly" }])),
    /reported no filename/
  );
});
