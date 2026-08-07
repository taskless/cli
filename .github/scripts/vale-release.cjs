// SPDX-License-Identifier: MIT
"use strict";

/**
 * Vale platform packages — pure, zero-dependency release logic.
 *
 * Everything here is a total function over plain data: no network, no
 * filesystem, no `process`. The I/O lives in the two sibling entry points that
 * consume this module —
 *
 *   vale-detect.cjs   compares the latest upstream Vale release against the
 *                     pinned one and rewrites the manifest for review.
 *   vale-prepare.cjs  downloads, verifies, unpacks, stamps, and packs.
 *
 * — which keeps the parts worth testing (version stamping, semver assertions,
 * digest comparison, manifest rewriting) directly unit-testable with
 * `node --test` and no build step, the same arrangement as stack-breadcrumb.cjs.
 *
 * The design decisions these functions encode live in
 * openspec/changes/add-vale-binary-packages/design.md; D4 (all-prerelease
 * timestamp versioning) and D6 (committed checksums are the trust boundary) are
 * the two that most of this file exists to enforce.
 */

// ---------------------------------------------------------------------------
// Version shapes
//
// Two distinct kinds of version appear here and conflating them is the mistake
// this section exists to prevent:
//
//   a VALE version    plain `major.minor.patch`, e.g. `3.17.1` — what upstream
//                     released. Never itself published to npm by us.
//   a STAMPED version `<valeVersion>-<yyyymmddhhmmss>`, e.g.
//                     `3.17.1-20260806120000` — what we publish, always.
//
// D4's four properties all follow from that second shape: provenance stays
// readable in the leading component, a packaging fix against the same upstream
// release gets a fresh timestamp rather than needing a version it does not own,
// the prerelease makes a caret range unable to resolve anything (see
// `rangeMatches`), and a 14-digit timestamp is a valid numeric prerelease
// identifier so ordering is numeric and monotonic.
// ---------------------------------------------------------------------------

/** A plain upstream Vale version: `major.minor.patch`, no prerelease, no build. */
const VALE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** A stamped package version: a Vale version plus a 14-digit UTC timestamp. */
const STAMPED_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)-(\d{14})$/;

/**
 * The version committed for every platform package. It is a placeholder and is
 * overwritten by `planStamp` before packing; it is never published as-is. Kept
 * here so the assertion in `planStamp` and the scaffolding agree on one value.
 */
const PLACEHOLDER_VERSION = "0.0.0";

/**
 * Parse a plain Vale version into its numeric components. Throws on anything
 * that is not exactly `major.minor.patch` — including a version that already
 * carries a prerelease, which would otherwise let a stamped version be stamped
 * a second time and produce `3.17.1-2026…-2026…`.
 */
function parseValeVersion(text) {
  const match = VALE_VERSION_PATTERN.exec(String(text ?? ""));
  if (!match) {
    throw new Error(
      `not a plain Vale version (expected major.minor.patch): ${JSON.stringify(text)}`
    );
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Strip the leading `v` from an upstream git tag (`v3.17.1` → `3.17.1`) and
 * validate the remainder. Upstream tags its releases with the prefix; the
 * manifest stores the bare version.
 */
function parseReleaseTag(tag) {
  const text = String(tag ?? "").trim();
  const bare = text.startsWith("v") ? text.slice(1) : text;
  parseValeVersion(bare);
  return bare;
}

/**
 * Format a Date as the `yyyymmddhhmmss` UTC stamp. Derived from the ISO string
 * so the UTC conversion is the platform's, not ours: `2026-08-06T12:00:00.000Z`
 * → `20260806120000`.
 */
function formatStampTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("formatStampTimestamp requires a valid Date");
  }
  return date.toISOString().replaceAll(/\D/g, "").slice(0, 14);
}

/**
 * Build the one version the whole set is published under:
 * `<valeVersion>-<yyyymmddhhmmss>`. The result is run through
 * `assertStampedVersion`, so a caller cannot get an unvalidated version out of
 * here even by passing something strange in.
 */
function stampVersion(valeVersion, date) {
  parseValeVersion(valeVersion);
  const version = `${valeVersion}-${formatStampTimestamp(date)}`;
  assertStampedVersion(version);
  return version;
}

/**
 * Assert a version is a legitimate stamped version, and throw with a specific
 * reason when it is not. Four things are checked, one per property in D4:
 *
 *   1. it matches `major.minor.patch-<14 digits>` at all, so a plain Vale
 *      version — the thing that must never be published — cannot pass;
 *   2. the prerelease is a NUMERIC identifier under semver, meaning no leading
 *      zero. A leading zero would make semver treat it as alphanumeric and
 *      compare it lexically, breaking monotonic ordering;
 *   3. that number is inside the safe-integer range, so the numeric comparison
 *      is exact;
 *   4. the timestamp is a real calendar date, which catches a mangled stamp
 *      (`20261340…`) that would otherwise pass every syntactic check.
 */
function assertStampedVersion(version) {
  const text = String(version ?? "");
  const match = STAMPED_VERSION_PATTERN.exec(text);
  if (!match) {
    throw new Error(
      `not a stamped version (expected <valeVersion>-<yyyymmddhhmmss>): ${JSON.stringify(version)}`
    );
  }
  const timestamp = match[4];
  if (timestamp.startsWith("0")) {
    throw new Error(
      `timestamp ${timestamp} has a leading zero, so semver would compare it as a string rather than a number`
    );
  }
  const numeric = Number(timestamp);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error(`timestamp ${timestamp} is outside the safe-integer range`);
  }
  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(4, 6));
  const day = Number(timestamp.slice(6, 8));
  const hour = Number(timestamp.slice(8, 10));
  const minute = Number(timestamp.slice(10, 12));
  const second = Number(timestamp.slice(12, 14));
  const asDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (formatStampTimestamp(asDate) !== timestamp) {
    throw new Error(`timestamp ${timestamp} is not a real UTC date and time`);
  }
  return text;
}

/**
 * Order two stamped versions by semver precedence. Both are prereleases of the
 * form used here, so precedence is: compare `major.minor.patch` numerically,
 * then compare the single numeric prerelease identifier numerically. Returns
 * -1, 0, or 1.
 */
function compareStampedVersions(a, b) {
  const left = STAMPED_VERSION_PATTERN.exec(assertStampedVersion(a));
  const right = STAMPED_VERSION_PATTERN.exec(assertStampedVersion(b));
  for (let index = 1; index <= 4; index += 1) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference !== 0) {
      return difference < 0 ? -1 : 1;
    }
  }
  return 0;
}

/** Order two plain Vale versions numerically. Returns -1, 0, or 1. */
function compareValeVersions(a, b) {
  const left = parseValeVersion(a);
  const right = parseValeVersion(b);
  for (const part of ["major", "minor", "patch"]) {
    if (left[part] !== right[part]) {
      return left[part] < right[part] ? -1 : 1;
    }
  }
  return 0;
}

/** True when upstream has released a Vale version newer than the pinned one. */
function isUpstreamAhead(pinnedVersion, upstreamVersion) {
  return compareValeVersions(upstreamVersion, pinnedVersion) > 0;
}

/**
 * Does a dependency range match a version, for the narrow subset of ranges D4
 * cares about: an exact version, `^x.y.z`, or `~x.y.z`.
 *
 * This is not a general semver resolver and is not used to resolve anything. It
 * exists so D4's third property — "exact pinning is enforced by semver, not
 * convention" — is asserted by a test rather than asserted in prose. It encodes
 * the one semver rule that produces that property:
 *
 *   a version carrying a prerelease satisfies a range only if some comparator
 *   in that range names the same major.minor.patch AND itself carries a
 *   prerelease.
 *
 * `^3.17.1` desugars to `>=3.17.1 <4.0.0`; neither comparator carries a
 * prerelease, so `3.17.1-20260806120000` cannot satisfy it. Only the literal
 * `3.17.1-20260806120000` does. That is what makes a consumer physically unable
 * to float across published platform packages.
 */
function rangeMatches(range, version) {
  const text = String(range ?? "").trim();
  const operator = text.startsWith("^") ? "^" : text.startsWith("~") ? "~" : "";
  const target = operator === "" ? text : text.slice(1);

  const stamped = STAMPED_VERSION_PATTERN.exec(String(version ?? ""));
  const plain = VALE_VERSION_PATTERN.exec(String(version ?? ""));
  if (!stamped && !plain) {
    throw new Error(`unsupported version: ${JSON.stringify(version)}`);
  }

  if (stamped) {
    // The prerelease-exclusion rule. A caret or tilde range written over a
    // plain Vale version has no prerelease anywhere in it, so it is out
    // immediately; an exact range matches only when it is character-identical.
    if (operator !== "") {
      return false;
    }
    return target === String(version);
  }

  // A plain version against a plain range: ordinary caret/tilde semantics,
  // included only so the tests can contrast the two cases.
  const rangeParts = parseValeVersion(target);
  const versionParts = parseValeVersion(String(version));
  if (operator === "") {
    return compareValeVersions(target, String(version)) === 0;
  }
  if (compareValeVersions(String(version), target) < 0) {
    return false;
  }
  if (versionParts.major !== rangeParts.major) {
    return false;
  }
  if (operator === "~" && versionParts.minor !== rangeParts.minor) {
    return false;
  }
  if (operator === "^" && rangeParts.major === 0) {
    // Caret below 1.0.0 narrows twice: `^0.y.z` allows the patch to float but
    // pins the minor, and `^0.0.z` desugars to `>=0.0.z <0.0.(z+1)`, which is
    // the single version itself.
    if (rangeParts.minor === 0) {
      return (
        versionParts.minor === 0 && versionParts.patch === rangeParts.patch
      );
    }
    return versionParts.minor === rangeParts.minor;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Manifest
//
// .github/scripts/vale-manifest.json pins the upstream Vale version and, per
// platform, the release asset, the member to unpack from it, and the SHA256 of
// the ARCHIVE. The digest covers the archive rather than the executable because
// that is what upstream publishes in vale_<version>_checksums.txt — so the
// committed value is checkable against upstream, and the archive is verified
// before anything is unpacked from it (D6).
// ---------------------------------------------------------------------------

const MANIFEST_PLATFORM_FIELDS = [
  "package",
  "directory",
  "os",
  "cpu",
  "asset",
  "archiveMember",
  "sha256",
];

const SHA256_PATTERN = /^[\da-f]{64}$/;

/**
 * Validate a parsed manifest's shape and throw on the first problem. Called by
 * both entry points before they do anything, so a hand-edit that drops a field
 * fails immediately with a readable message rather than partway through a
 * download loop.
 */
function assertManifest(manifest) {
  if (typeof manifest !== "object" || manifest === null) {
    throw new TypeError("manifest must be an object");
  }
  parseValeVersion(manifest.valeVersion);
  const upstream = manifest.upstream;
  if (typeof upstream !== "object" || upstream === null) {
    throw new Error("manifest.upstream is missing");
  }
  for (const field of ["repository", "tag", "downloadUrl", "checksumsAsset"]) {
    if (typeof upstream[field] !== "string" || upstream[field].length === 0) {
      throw new Error(`manifest.upstream.${field} is missing`);
    }
  }
  if (!Array.isArray(manifest.platforms) || manifest.platforms.length === 0) {
    throw new Error("manifest.platforms must be a non-empty array");
  }
  const seen = new Set();
  for (const platform of manifest.platforms) {
    for (const field of MANIFEST_PLATFORM_FIELDS) {
      if (typeof platform[field] !== "string" || platform[field].length === 0) {
        throw new Error(
          `manifest platform ${JSON.stringify(platform.package ?? "?")} is missing ${field}`
        );
      }
    }
    // The containment checks in vale-prepare.cjs's unpackMember run after
    // extraction, so they cover the member's LEAF entry only: an intermediate
    // directory component that is itself a symlink pointing out of the unpack
    // directory would be followed by tar while writing, before there is any
    // path to inspect. Requiring a flat filename deletes that case rather than
    // leaving it to the extractor's own symlink refusal — and keeps the
    // requirement here, where a hand-edited manifest is rejected up front,
    // instead of as a comment someone has to notice.
    if (
      /[/\\]/.test(platform.archiveMember) ||
      platform.archiveMember === ".."
    ) {
      throw new Error(
        `manifest platform ${platform.package} has an archiveMember that is not a flat filename: ${platform.archiveMember}`
      );
    }
    if (!SHA256_PATTERN.test(platform.sha256)) {
      throw new Error(
        `manifest platform ${platform.package} has a sha256 that is not 64 lowercase hex characters`
      );
    }
    if (seen.has(platform.package)) {
      throw new Error(`manifest lists ${platform.package} more than once`);
    }
    seen.add(platform.package);
  }
  return manifest;
}

/** Substitute `{version}` (and optionally `{asset}`) into a manifest template. */
function applyTemplate(template, values) {
  return String(template).replaceAll(/{(\w+)}/g, (whole, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : whole
  );
}

/** The resolved asset filename for a platform at the manifest's Vale version. */
function resolveAssetName(manifest, platform) {
  return applyTemplate(platform.asset, { version: manifest.valeVersion });
}

/** The full download URL for a platform's archive. */
function resolveDownloadUrl(manifest, platform) {
  return applyTemplate(manifest.upstream.downloadUrl, {
    version: manifest.valeVersion,
    asset: resolveAssetName(manifest, platform),
  });
}

/** The full download URL for the upstream checksums file. */
function resolveChecksumsUrl(manifest, version = manifest.valeVersion) {
  return applyTemplate(manifest.upstream.downloadUrl, {
    version,
    asset: applyTemplate(manifest.upstream.checksumsAsset, { version }),
  });
}

// ---------------------------------------------------------------------------
// Digest verification (D6)
// ---------------------------------------------------------------------------

/**
 * Parse an upstream `vale_<version>_checksums.txt` into a Map of asset name to
 * digest. The format is the sha256sum one: `<64 hex>  <filename>`, with the
 * filename possibly prefixed by `*` for binary mode.
 */
function parseChecksumsFile(text) {
  const digests = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const match = /^([\da-f]{64})\s+\*?(.+)$/i.exec(trimmed);
    if (!match) {
      continue;
    }
    digests.set(match[2].trim(), match[1].toLowerCase());
  }
  return digests;
}

/**
 * Compare a computed digest against the committed one and throw on a mismatch.
 * The thrown message names the asset and both digests, because the operator
 * reading a failed run needs to tell "upstream re-cut the release" apart from
 * "the manifest was updated without re-running the fetch".
 *
 * Callers treat this as fatal: nothing downstream of a mismatch runs, which is
 * what the requirement "checksum mismatch aborts the release" means in practice.
 */
function assertChecksum({ asset, expected, actual }) {
  const want = String(expected ?? "").toLowerCase();
  const got = String(actual ?? "").toLowerCase();
  if (!SHA256_PATTERN.test(want)) {
    throw new Error(`no committed sha256 for ${asset}`);
  }
  if (want !== got) {
    throw new Error(
      `sha256 mismatch for ${asset}\n  committed: ${want}\n  downloaded: ${got}\nRefusing to package or publish unverified bytes.`
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Detect phase
// ---------------------------------------------------------------------------

/**
 * Decide what the detect phase should do, given the pinned manifest, the latest
 * upstream tag, and (when upstream is ahead) that release's checksums file.
 *
 * Returns `{ update: false, … }` when upstream is not ahead — the ONLY thing
 * that bounds these runs. A published-version check could not: every publish
 * stamps a timestamp npm has never seen, so it would report "not published" on
 * every run and never suppress anything (D5).
 *
 * When upstream is ahead it returns the rewritten manifest, with `valeVersion`
 * and every `sha256` taken from upstream's own checksums file and every other
 * field left alone. A platform whose asset is absent from that file throws
 * rather than silently carrying a stale digest forward, which would otherwise
 * produce a manifest that fails verification only later, inside the publish run.
 */
function planManifestUpdate({ manifest, upstreamTag, checksumsText }) {
  assertManifest(manifest);
  const upstreamVersion = parseReleaseTag(upstreamTag);
  if (!isUpstreamAhead(manifest.valeVersion, upstreamVersion)) {
    return {
      update: false,
      pinnedVersion: manifest.valeVersion,
      upstreamVersion,
      manifest,
    };
  }

  const digests = parseChecksumsFile(checksumsText);
  if (digests.size === 0) {
    throw new Error(
      `upstream checksums file for ${upstreamVersion} parsed to no entries`
    );
  }

  const platforms = manifest.platforms.map((platform) => {
    const asset = applyTemplate(platform.asset, { version: upstreamVersion });
    const sha256 = digests.get(asset);
    if (sha256 === undefined) {
      throw new Error(
        `upstream ${upstreamVersion} publishes no asset named ${asset} (needed by ${platform.package})`
      );
    }
    return { ...platform, sha256 };
  });

  return {
    update: true,
    pinnedVersion: manifest.valeVersion,
    upstreamVersion,
    manifest: { ...manifest, valeVersion: upstreamVersion, platforms },
  };
}

// ---------------------------------------------------------------------------
// Stamp phase
// ---------------------------------------------------------------------------

/**
 * Plan the version write for every platform package: one version, computed
 * once, applied identically across the set. Nothing here is per-platform, which
 * is the point — six packages carrying the same upstream Vale build that
 * disagreed about their version would make the CLI's exact pins unresolvable on
 * some hosts and resolvable on others.
 */
function planStamp({ manifest, date }) {
  assertManifest(manifest);
  const version = stampVersion(manifest.valeVersion, date);
  return {
    version,
    packages: manifest.platforms.map((platform) => ({
      package: platform.package,
      directory: platform.directory,
      version,
    })),
  };
}

/**
 * Apply a stamped version to a parsed `package.json`, returning a new object.
 * Refuses to stamp a package.json whose version is neither the committed
 * placeholder nor an already-stamped version, so a hand-edit that put a real
 * version into a platform package is caught rather than overwritten silently.
 */
function applyStamp(packageJson, version) {
  assertStampedVersion(version);
  const current = String(packageJson.version ?? "");
  if (current !== PLACEHOLDER_VERSION) {
    assertStampedVersion(current);
  }
  return { ...packageJson, version };
}

module.exports = {
  PLACEHOLDER_VERSION,
  applyStamp,
  applyTemplate,
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
};
