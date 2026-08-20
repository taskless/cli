#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * @taskless/cli-nightly — compute the nightly version and pack the CLI under
 * the nightly name.
 *
 * A nightly is byte-for-byte the same build as the release it anticipates,
 * differing only in `name` and `version` (design D2). Both are applied HERE, at
 * pack time, to a copy of packages/cli/package.json that is written, packed,
 * and then restored — the committed manifest is never left rewritten, so
 * nothing about the ordinary release path is touched. `bin`, `files`,
 * `dependencies`, and `optionalDependencies` are carried through untouched: the
 * nightly resolves the same pinned Vale and ast-grep platform packages as the
 * release, and still installs a `taskless` executable.
 *
 * This file is both a module and an entry point: the pure functions below are
 * unit-tested by nightly-pack.test.cjs with `node --test` and no build step
 * (the same arrangement as vale-release.cjs), while `main()` runs only when the
 * file is invoked directly.
 *
 * Usage:
 *   node .github/scripts/nightly-pack.cjs --status <file> --sha <short-sha> [--out <dir>]
 *
 *   --status  the JSON file written by `changeset status --output=<path>`.
 *             MUST be a repo-relative path when produced: `--output` resolves
 *             against the process working directory with no special case for a
 *             leading `/`, so `--output=/tmp/status.json` means
 *             `<cwd>/tmp/status.json` and fails with ENOENT from the repo root.
 *   --sha     the short commit hash to stamp into the version.
 *   --out     where to write the .tgz (default: .nightly-dist at the repo root).
 *
 * Writes `version` and `tarball` to $GITHUB_OUTPUT when it is set.
 */

const {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require("node:fs");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = resolve(__dirname, "..", "..");

/** The package the nightly is built from, and the name it is published under. */
const SOURCE_PACKAGE = "@taskless/cli";
const NIGHTLY_PACKAGE = "@taskless/cli-nightly";

/** A released CLI version: plain `major.minor.patch`, no prerelease. */
const PLAIN_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/** An abbreviated git object name. */
const SHORT_SHA_PATTERN = /^[0-9a-f]{7,40}$/;

/**
 * The official semver 2.0.0 grammar, from semver.org. Used as an assertion in
 * `buildNightlyVersion` rather than only in a test: a version that npm would
 * reject should never be produced in the first place.
 */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** Is `text` a valid semantic version? */
function isValidVersion(text) {
  return SEMVER_PATTERN.test(String(text ?? ""));
}

/** `2026-08-18T12:34:56Z` → `20260818123456`, always UTC, always 14 digits. */
function formatStampTimestamp(date) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`not a usable date: ${JSON.stringify(date)}`);
  }
  return parsed.toISOString().replaceAll(/\D/g, "").slice(0, 14);
}

/**
 * Pick the version the pending changesets propose for the CLI.
 *
 * `changeset status --output=` writes an OBJECT whose per-package entries live
 * under `releases`, not an array at the root. Selection is BY NAME, never by
 * index: `releases` lists every package the pending changesets release, and
 * `[0]` is the CLI only for as long as the CLI is the sole changesets-managed
 * package. The six @taskless/vale-* packages already sit in the changesets
 * `ignore` list precisely because a second managed package is a thing that
 * happens; the day one is added, `[0]` would stamp the nightly with another
 * package's version — a wrong version that publishes successfully and looks
 * plausible.
 */
function selectProposedVersion(status, packageName = SOURCE_PACKAGE) {
  const releases = status && status.releases;
  if (!Array.isArray(releases)) {
    throw new Error(
      "changeset status output has no `releases` array — the file is an object, not an array; did the output shape change?"
    );
  }
  const release = releases.find((entry) => entry && entry.name === packageName);
  if (!release) {
    throw new Error(
      `changeset status proposes no release for ${packageName} (found: ${releases
        .map((entry) => entry && entry.name)
        .join(", ")})`
    );
  }
  if (!PLAIN_VERSION_PATTERN.test(String(release.newVersion ?? ""))) {
    throw new Error(
      `newVersion for ${packageName} is not major.minor.patch: ${JSON.stringify(release.newVersion)}`
    );
  }
  return release.newVersion;
}

/**
 * `<n.m.k>-<yyyymmddhhmmss>x<sha>` (design D3).
 *
 * The timestamp leads because it is fixed-width, so a lexical comparison of the
 * prerelease identifier orders builds chronologically; the sha trails because
 * it is what gate 2 matches on to decide whether a commit already has a
 * nightly.
 *
 * THE `x` IS LOAD-BEARING. It is the thing a later reader is most likely to
 * "simplify" away, so both failure modes it prevents are named here and both
 * are covered in nightly-pack.test.cjs:
 *
 *   `<timestamp>.<sha>`  A dot starts a NEW prerelease identifier. A short sha
 *                        of all digits beginning with `0` then forms a numeric
 *                        identifier with a leading zero, which semver forbids —
 *                        an INVALID version for roughly one commit in sixteen,
 *                        which is the worst failure cadence available.
 *   `<timestamp><sha>`   A bare concatenation is still *valid* (the timestamp's
 *                        leading digit is never 0), but for an all-digit sha it
 *                        is a single numeric identifier of 21 digits. Semver
 *                        compares numeric identifiers numerically, and that
 *                        exceeds what a double can represent exactly — so
 *                        ordering, the whole reason the timestamp leads, stops
 *                        being reliable, silently.
 *
 * `x` makes the identifier alphanumeric, so the numeric rule never applies and
 * comparison stays lexical for every sha.
 */
function buildNightlyVersion({ baseVersion, date, shortSha }) {
  if (!PLAIN_VERSION_PATTERN.test(String(baseVersion ?? ""))) {
    throw new Error(
      `base version is not major.minor.patch: ${JSON.stringify(baseVersion)}`
    );
  }
  const sha = String(shortSha ?? "").toLowerCase();
  if (!SHORT_SHA_PATTERN.test(sha)) {
    throw new Error(
      `not an abbreviated commit hash: ${JSON.stringify(shortSha)}`
    );
  }
  const version = `${baseVersion}-${formatStampTimestamp(date)}x${sha}`;
  if (!isValidVersion(version)) {
    throw new Error(`refusing to stamp an invalid version: ${version}`);
  }
  return version;
}

/**
 * Return the manifest to publish: the committed one with `name` and `version`
 * replaced and every other field — `bin`, `files`, `dependencies`,
 * `optionalDependencies`, `engines`, `exports` — carried through by value.
 */
function applyNightlyIdentity(packageJson, version) {
  return { ...packageJson, name: NIGHTLY_PACKAGE, version };
}

/**
 * Does any published version belong to this commit? Gate 2, as a pure function
 * over what `npm view <pkg> versions --json` returned.
 *
 * `--json` yields an ARRAY for a package with several versions and a bare
 * STRING for one with exactly one — which the nightly package will be, once,
 * right after its bootstrap publish. Normalizing both is the difference between
 * a working gate and one that skips every build for a day.
 */
function hasNightlyForSha(versions, shortSha) {
  const sha = String(shortSha ?? "").toLowerCase();
  if (!SHORT_SHA_PATTERN.test(sha)) {
    throw new Error(
      `not an abbreviated commit hash: ${JSON.stringify(shortSha)}`
    );
  }
  const list =
    typeof versions === "string"
      ? [versions]
      : Array.isArray(versions)
        ? versions
        : [];
  return list.some((version) => String(version).endsWith(`x${sha}`));
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArguments(argv) {
  const options = { out: join(REPO_ROOT, ".nightly-dist") };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--status") {
      index += 1;
      options.status = resolve(requireValue(argv, index, "--status"));
    } else if (argument === "--sha") {
      index += 1;
      options.sha = requireValue(argv, index, "--sha");
    } else if (argument === "--out") {
      index += 1;
      options.out = resolve(requireValue(argv, index, "--out"));
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!options.status) {
    throw new Error("--status is required");
  }
  if (!options.sha) {
    throw new Error("--sha is required");
  }
  return options;
}

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const status = JSON.parse(readFileSync(options.status, "utf8"));
  const version = buildNightlyVersion({
    baseVersion: selectProposedVersion(status),
    date: new Date(),
    shortSha: options.sha,
  });

  const packageDirectory = join(REPO_ROOT, "packages", "cli");
  const packageJsonPath = join(packageDirectory, "package.json");
  const committed = readFileSync(packageJsonPath, "utf8");
  const nightly = applyNightlyIdentity(JSON.parse(committed), version);

  console.log(`${NIGHTLY_PACKAGE}@${version}`);
  mkdirSync(options.out, { recursive: true });

  // Written, packed, restored. `npm pack` reads the manifest off disk, so the
  // rewrite has to be real — but it lives only for the length of the pack, and
  // the restore is in `finally` so a failed pack does not strand a rewritten
  // manifest in the working tree.
  writeFileSync(packageJsonPath, `${JSON.stringify(nightly, null, 2)}\n`);
  let packed;
  try {
    packed = spawnSync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", options.out],
      { cwd: packageDirectory, encoding: "utf8" }
    );
  } finally {
    writeFileSync(packageJsonPath, committed);
  }

  if (packed.error) {
    throw packed.error;
  }
  if (packed.status !== 0) {
    throw new Error(
      `npm pack exited with status ${packed.status}\n${packed.stderr}`
    );
  }

  // npm reports the filename it chose; deriving it from the package name would
  // be re-deriving what the tool already told us.
  const [entry] = JSON.parse(packed.stdout);
  const tarball = join(options.out, entry.filename);
  console.log(`packed ${tarball}`);

  setOutput("version", version);
  setOutput("tarball", tarball);
}

module.exports = {
  NIGHTLY_PACKAGE,
  SOURCE_PACKAGE,
  applyNightlyIdentity,
  buildNightlyVersion,
  formatStampTimestamp,
  hasNightlyForSha,
  isValidVersion,
  selectProposedVersion,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`\nnightly-pack failed: ${error.message}`);
    process.exitCode = 1;
  }
}
