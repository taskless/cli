// SPDX-License-Identifier: MIT
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const {
  PLACEHOLDER_VERSION,
  applyStamp,
  assertChecksum,
  assertManifest,
  assertStampedVersion,
  compareStampedVersions,
  compareValeVersions,
  formatStampTimestamp,
  isUpstreamAhead,
  parseChecksumsFile,
  parseReleaseTag,
  parseValeVersion,
  planManifestUpdate,
  planStamp,
  rangeMatches,
  resolveAssetName,
  resolveChecksumsUrl,
  resolveDownloadUrl,
  stampVersion,
} = require("./vale-release.cjs");

/** The manifest as committed, so these tests fail if it drifts out of shape. */
const COMMITTED_MANIFEST = JSON.parse(
  readFileSync(join(__dirname, "vale-manifest.json"), "utf8")
);

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function fixtureManifest() {
  return {
    valeVersion: "3.17.1",
    upstream: {
      repository: "errata-ai/vale",
      tag: "v{version}",
      downloadUrl:
        "https://github.com/errata-ai/vale/releases/download/v{version}/{asset}",
      checksumsAsset: "vale_{version}_checksums.txt",
    },
    platforms: [
      {
        package: "@taskless/vale-linux-x64",
        directory: "packages/vale-linux-x64",
        os: "linux",
        cpu: "x64",
        asset: "vale_{version}_Linux_64-bit.tar.gz",
        archiveMember: "vale",
        sha256: DIGEST_A,
      },
      {
        package: "@taskless/vale-win32-x64",
        directory: "packages/vale-win32-x64",
        os: "win32",
        cpu: "x64",
        asset: "vale_{version}_Windows_64-bit.zip",
        archiveMember: "vale.exe",
        sha256: DIGEST_B,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Version parsing and stamping (tasks 4.1, 4.2)
// ---------------------------------------------------------------------------

test("parseValeVersion: accepts a plain version, rejects a stamped one", () => {
  assert.deepEqual(parseValeVersion("3.17.1"), {
    major: 3,
    minor: 17,
    patch: 1,
  });
  assert.throws(() => parseValeVersion("3.17.1-20260806120000"), /plain Vale/);
  assert.throws(() => parseValeVersion("v3.17.1"), /plain Vale/);
  assert.throws(() => parseValeVersion("3.17"), /plain Vale/);
  assert.throws(() => parseValeVersion(undefined), /plain Vale/);
});

test("parseReleaseTag: strips the upstream v prefix", () => {
  assert.equal(parseReleaseTag("v3.17.1"), "3.17.1");
  assert.equal(parseReleaseTag("3.17.1"), "3.17.1");
  assert.throws(() => parseReleaseTag("v3.17"), /plain Vale/);
});

test("formatStampTimestamp: 14 UTC digits, no separators", () => {
  assert.equal(
    formatStampTimestamp(new Date("2026-08-06T12:00:00.000Z")),
    "20260806120000"
  );
  // A non-UTC input is still stamped in UTC.
  assert.equal(
    formatStampTimestamp(new Date("2026-08-06T12:00:00.000+02:00")),
    "20260806100000"
  );
  assert.throws(() => formatStampTimestamp("2026-08-06"), TypeError);
  assert.throws(() => formatStampTimestamp(new Date("nope")), TypeError);
});

test("stampVersion: produces <valeVersion>-<yyyymmddhhmmss>", () => {
  assert.equal(
    stampVersion("3.17.1", new Date("2026-08-06T12:00:00Z")),
    "3.17.1-20260806120000"
  );
});

test("stampVersion: a bare Vale version can never be produced", () => {
  // Every stamp carries a timestamp, so the output always contains a `-`.
  for (const iso of [
    "2026-01-01T00:00:00Z",
    "2026-08-06T12:34:56Z",
    "2099-12-31T23:59:59Z",
  ]) {
    const version = stampVersion("3.17.1", new Date(iso));
    assert.notEqual(version, "3.17.1");
    assert.match(version, /^3\.17\.1-\d{14}$/);
  }
  // And the assertion itself refuses a bare version outright.
  assert.throws(() => assertStampedVersion("3.17.1"), /not a stamped version/);
});

test("assertStampedVersion: rejects a leading-zero timestamp", () => {
  // A leading zero makes semver treat the identifier as alphanumeric, which
  // would compare lexically and break monotonic ordering.
  assert.throws(
    () => assertStampedVersion("3.17.1-02608061200000"),
    /leading zero/
  );
});

test("assertStampedVersion: rejects a timestamp that is not a real date", () => {
  assert.throws(
    () => assertStampedVersion("3.17.1-20261340120000"),
    /not a real UTC date/
  );
});

test("assertStampedVersion: rejects other prerelease shapes", () => {
  assert.throws(
    () => assertStampedVersion("3.17.1-taskless.1"),
    /not a stamped version/
  );
  assert.throws(
    () => assertStampedVersion("3.17.1-2026080612000"),
    /not a stamped version/
  );
  assert.throws(
    () => assertStampedVersion("3.17.1+20260806120000"),
    /not a stamped version/
  );
});

test("assertStampedVersion: the timestamp stays a safe integer", () => {
  const version = assertStampedVersion("3.17.1-20260806120000");
  const timestamp = Number(version.split("-")[1]);
  assert.ok(Number.isSafeInteger(timestamp));
});

// ---------------------------------------------------------------------------
// Ordering (task 4.3)
// ---------------------------------------------------------------------------

test("compareStampedVersions: two runs produce ordered versions", () => {
  const earlier = stampVersion("3.17.1", new Date("2026-08-06T12:00:00Z"));
  const later = stampVersion("3.17.1", new Date("2026-08-06T12:00:01Z"));
  assert.equal(compareStampedVersions(earlier, later), -1);
  assert.equal(compareStampedVersions(later, earlier), 1);
  assert.equal(compareStampedVersions(later, later), 0);
});

test("compareStampedVersions: a newer Vale version outranks any timestamp", () => {
  assert.equal(
    compareStampedVersions("3.17.1-29991231235959", "3.17.2-20260101000000"),
    -1
  );
});

test("compareValeVersions and isUpstreamAhead", () => {
  assert.equal(compareValeVersions("3.17.1", "3.17.2"), -1);
  assert.equal(compareValeVersions("3.18.0", "3.17.9"), 1);
  assert.equal(compareValeVersions("3.17.1", "3.17.1"), 0);
  assert.equal(isUpstreamAhead("3.17.1", "3.17.2"), true);
  assert.equal(isUpstreamAhead("3.17.1", "3.17.1"), false);
  assert.equal(isUpstreamAhead("3.17.1", "3.17.0"), false);
});

// ---------------------------------------------------------------------------
// Range resolution (task 4.3 — D4 property 3)
// ---------------------------------------------------------------------------

test("rangeMatches: a caret or tilde range over the Vale version matches nothing", () => {
  const version = "3.17.1-20260806120000";
  assert.equal(rangeMatches("^3.17.1", version), false);
  assert.equal(rangeMatches("~3.17.1", version), false);
  assert.equal(rangeMatches("^3.0.0", version), false);
  assert.equal(rangeMatches("~3.17.0", version), false);
});

test("rangeMatches: only the literal exact version resolves", () => {
  const version = "3.17.1-20260806120000";
  assert.equal(rangeMatches(version, version), true);
  assert.equal(rangeMatches("3.17.1", version), false);
  assert.equal(rangeMatches("3.17.1-20260806120001", version), false);
});

test("rangeMatches: plain versions keep ordinary caret/tilde semantics", () => {
  // The contrast that makes the prerelease exclusion above meaningful: the same
  // ranges do match when the version carries no prerelease.
  assert.equal(rangeMatches("^3.17.1", "3.18.0"), true);
  assert.equal(rangeMatches("~3.17.1", "3.17.9"), true);
  assert.equal(rangeMatches("~3.17.1", "3.18.0"), false);
  assert.equal(rangeMatches("^3.17.1", "4.0.0"), false);
  assert.equal(rangeMatches("^3.17.1", "3.17.0"), false);
});

// ---------------------------------------------------------------------------
// Stamping the set (task 4.1, 4.3)
// ---------------------------------------------------------------------------

test("planStamp: the whole set shares one version", () => {
  const plan = planStamp({
    manifest: COMMITTED_MANIFEST,
    date: new Date("2026-08-06T12:00:00Z"),
  });
  assert.equal(
    plan.version,
    `${COMMITTED_MANIFEST.valeVersion}-20260806120000`
  );
  assert.equal(plan.packages.length, 6);
  assert.equal(new Set(plan.packages.map((p) => p.version)).size, 1);
  for (const entry of plan.packages) {
    assert.equal(entry.version, plan.version);
  }
});

test("planStamp: covers every committed platform package", () => {
  const plan = planStamp({
    manifest: COMMITTED_MANIFEST,
    date: new Date("2026-08-06T12:00:00Z"),
  });
  assert.deepEqual(plan.packages.map((p) => p.package).sort(), [
    "@taskless/vale-darwin-arm64",
    "@taskless/vale-darwin-x64",
    "@taskless/vale-linux-arm64",
    "@taskless/vale-linux-x64",
    "@taskless/vale-win32-arm64",
    "@taskless/vale-win32-x64",
  ]);
});

test("applyStamp: replaces the placeholder and re-stamps a stamped package", () => {
  const stamped = applyStamp(
    { name: "@taskless/vale-linux-x64", version: PLACEHOLDER_VERSION },
    "3.17.1-20260806120000"
  );
  assert.equal(stamped.version, "3.17.1-20260806120000");
  assert.equal(
    applyStamp(stamped, "3.17.1-20260806120001").version,
    "3.17.1-20260806120001"
  );
});

test("applyStamp: refuses a package.json carrying an unexpected version", () => {
  assert.throws(
    () => applyStamp({ version: "1.2.3" }, "3.17.1-20260806120000"),
    /not a stamped version/
  );
});

// ---------------------------------------------------------------------------
// Manifest validation and templating
// ---------------------------------------------------------------------------

test("assertManifest: the committed manifest is well formed", () => {
  assert.doesNotThrow(() => assertManifest(COMMITTED_MANIFEST));
  assert.equal(COMMITTED_MANIFEST.platforms.length, 6);
});

test("assertManifest: every committed platform has a package directory entry", () => {
  for (const platform of COMMITTED_MANIFEST.platforms) {
    assert.equal(
      platform.directory,
      `packages/${platform.package.replace("@taskless/", "")}`
    );
  }
});

test("assertManifest: rejects a missing field, a bad digest, and a duplicate", () => {
  const missing = fixtureManifest();
  delete missing.platforms[0].archiveMember;
  assert.throws(() => assertManifest(missing), /missing archiveMember/);

  const badDigest = fixtureManifest();
  badDigest.platforms[0].sha256 = "not-a-digest";
  assert.throws(() => assertManifest(badDigest), /64 lowercase hex/);

  const duplicate = fixtureManifest();
  duplicate.platforms[1].package = duplicate.platforms[0].package;
  assert.throws(() => assertManifest(duplicate), /more than once/);

  const noUpstream = fixtureManifest();
  delete noUpstream.upstream.downloadUrl;
  assert.throws(() => assertManifest(noUpstream), /upstream\.downloadUrl/);
});

test("resolve*: templates expand against the pinned version", () => {
  const manifest = fixtureManifest();
  const [linux] = manifest.platforms;
  assert.equal(
    resolveAssetName(manifest, linux),
    "vale_3.17.1_Linux_64-bit.tar.gz"
  );
  assert.equal(
    resolveDownloadUrl(manifest, linux),
    "https://github.com/errata-ai/vale/releases/download/v3.17.1/vale_3.17.1_Linux_64-bit.tar.gz"
  );
  assert.equal(
    resolveChecksumsUrl(manifest),
    "https://github.com/errata-ai/vale/releases/download/v3.17.1/vale_3.17.1_checksums.txt"
  );
});

// ---------------------------------------------------------------------------
// Digest verification (task 3.4)
// ---------------------------------------------------------------------------

test("parseChecksumsFile: parses the upstream sha256sum format", () => {
  const digests = parseChecksumsFile(
    [
      `${DIGEST_A}  vale_3.17.1_Linux_64-bit.tar.gz`,
      `${DIGEST_B} *vale_3.17.1_Windows_64-bit.zip`,
      "",
      "garbage line that is not a digest",
    ].join("\n")
  );
  assert.equal(digests.size, 2);
  assert.equal(digests.get("vale_3.17.1_Linux_64-bit.tar.gz"), DIGEST_A);
  assert.equal(digests.get("vale_3.17.1_Windows_64-bit.zip"), DIGEST_B);
});

test("assertChecksum: a matching digest succeeds", () => {
  assert.equal(
    assertChecksum({ asset: "a.tar.gz", expected: DIGEST_A, actual: DIGEST_A }),
    true
  );
  // Case is normalized on both sides.
  assert.equal(
    assertChecksum({
      asset: "a.tar.gz",
      expected: DIGEST_A.toUpperCase(),
      actual: DIGEST_A,
    }),
    true
  );
});

test("assertChecksum: a mismatched digest aborts", () => {
  assert.throws(
    () =>
      assertChecksum({
        asset: "vale_3.17.1_Linux_64-bit.tar.gz",
        expected: DIGEST_A,
        actual: DIGEST_B,
      }),
    /sha256 mismatch for vale_3\.17\.1_Linux_64-bit\.tar\.gz[\S\s]*Refusing to package or publish/
  );
});

test("assertChecksum: an absent committed digest aborts", () => {
  assert.throws(
    () => assertChecksum({ asset: "a.tar.gz", actual: DIGEST_A }),
    /no committed sha256/
  );
});

// ---------------------------------------------------------------------------
// Detect phase (tasks 5.2, 5.4)
// ---------------------------------------------------------------------------

test("planManifestUpdate: upstream unchanged plans nothing", () => {
  const result = planManifestUpdate({
    manifest: fixtureManifest(),
    upstreamTag: "v3.17.1",
    checksumsText: "",
  });
  assert.equal(result.update, false);
  assert.equal(result.upstreamVersion, "3.17.1");
});

test("planManifestUpdate: an older upstream tag plans nothing", () => {
  const result = planManifestUpdate({
    manifest: fixtureManifest(),
    upstreamTag: "v3.17.0",
    checksumsText: "",
  });
  assert.equal(result.update, false);
});

test("planManifestUpdate: a newer upstream rewrites version and digests only", () => {
  const manifest = fixtureManifest();
  const result = planManifestUpdate({
    manifest,
    upstreamTag: "v3.18.0",
    checksumsText: [
      `${DIGEST_B}  vale_3.18.0_Linux_64-bit.tar.gz`,
      `${DIGEST_A}  vale_3.18.0_Windows_64-bit.zip`,
    ].join("\n"),
  });
  assert.equal(result.update, true);
  assert.equal(result.pinnedVersion, "3.17.1");
  assert.equal(result.manifest.valeVersion, "3.18.0");
  assert.equal(result.manifest.platforms[0].sha256, DIGEST_B);
  assert.equal(result.manifest.platforms[1].sha256, DIGEST_A);
  // Asset templates are untouched, so they still carry {version}.
  assert.equal(
    result.manifest.platforms[0].asset,
    "vale_{version}_Linux_64-bit.tar.gz"
  );
  assert.equal(result.manifest.platforms[0].archiveMember, "vale");
  // And the input manifest is not mutated.
  assert.equal(manifest.valeVersion, "3.17.1");
  assert.equal(manifest.platforms[0].sha256, DIGEST_A);
  assert.doesNotThrow(() => assertManifest(result.manifest));
});

test("planManifestUpdate: a platform missing from upstream's checksums aborts", () => {
  assert.throws(
    () =>
      planManifestUpdate({
        manifest: fixtureManifest(),
        upstreamTag: "v3.18.0",
        checksumsText: `${DIGEST_B}  vale_3.18.0_Linux_64-bit.tar.gz`,
      }),
    /publishes no asset named vale_3\.18\.0_Windows_64-bit\.zip/
  );
});

test("planManifestUpdate: an unparseable checksums file aborts", () => {
  assert.throws(
    () =>
      planManifestUpdate({
        manifest: fixtureManifest(),
        upstreamTag: "v3.18.0",
        checksumsText: "404: Not Found",
      }),
    /parsed to no entries/
  );
});
