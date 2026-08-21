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
 * TWO MODES, AND THE VERSION IS COMPUTED IN EXACTLY ONE OF THEM.
 *
 *   node .github/scripts/nightly-pack.cjs --print-version --status <file> --sha <short-sha>
 *   node .github/scripts/nightly-pack.cjs --version <version> [--out <dir>]
 *
 *   --print-version  stamp the version from the pending changesets, the current
 *                    UTC time, and the sha; print it and set the `version`
 *                    output. Packs nothing.
 *   --status         the JSON file written by `changeset status --output=<path>`.
 *                    MUST be a repo-relative path when produced: `--output`
 *                    resolves against the process working directory with no
 *                    special case for a leading `/`, so
 *                    `--output=/tmp/status.json` means `<cwd>/tmp/status.json`
 *                    and fails with ENOENT from the repo root.
 *   --sha            the short commit hash to stamp into the version.
 *   --version        the already-stamped version to pack under.
 *   --out            where to write the .tgz (default: .nightly-dist at the
 *                    repo root).
 *
 * The split exists because the version has a SECOND consumer: the CLI build
 * bakes `npx @taskless/cli-nightly@<version>` into every skill, command, and
 * recipe it emits (TASKLESS_NIGHTLY_VERSION, see
 * packages/cli/scripts/build-target.ts). A version computed independently in
 * each place is computed from a different clock, so the shipped instructions
 * would name a version that was never published — an agent sent to a package
 * that 404s, or worse, silently to `@taskless/cli`. Pack mode therefore CANNOT
 * recompute: it takes `--version` and rejects `--status`/`--sha` outright,
 * rather than merely happening not to look at the clock.
 *
 * Writes `version` (both modes) and `tarball` (pack mode) to $GITHUB_OUTPUT
 * when it is set.
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
/**
 * The README the nightly ships, replacing the CLI's own.
 *
 * npm always includes README.md in a tarball regardless of `files`, so without
 * this the nightly's package page shows @taskless/cli's documentation —
 * install instructions for a different package, under a name that is not the
 * one being read about. Someone landing there from a search would follow them
 * and never learn this is a prerelease of something else.
 *
 * Deliberately minimal: it says what the package is, points at the real one,
 * and does not duplicate documentation that would then need to stay in sync
 * with a file it was copied from.
 */
function buildNightlyReadme(version) {
  return [
    `# ${NIGHTLY_PACKAGE}`,
    "",
    `Nightly build of [\`${SOURCE_PACKAGE}\`](https://www.npmjs.com/package/${SOURCE_PACKAGE}) — the same source and the same build, published from an unreleased commit on \`main\`.`,
    "",
    "**For documentation, installation, and support, see " +
      `[\`${SOURCE_PACKAGE}\`](https://www.npmjs.com/package/${SOURCE_PACKAGE}).**`,
    "",
    "## What this is",
    "",
    `This build is \`${version}\`. The version reads as \`<next release>-<UTC build time>x<commit>\`, so it names the release it anticipates, when it was built, and the commit it came from.`,
    "",
    `It installs the same \`taskless\` executable as the release. **Do not install both globally** — they collide on that name, and that configuration is not supported.`,
    "",
    "Nightlies exist to exercise merged-but-unreleased work. They are not release candidates and carry no stability guarantee.",
    "",
    `Source: https://github.com/taskless/cli`,
    "",
  ].join("\n");
}

/**
 * Turn what `npm view <pkg> versions --json` actually produced into a list of
 * versions — or throw, because gate 2 has no safe default.
 *
 * THREE OUTCOMES, NOT TWO. The gate's job is suppression, so "I could not tell"
 * must not collapse into "nothing published." It would not surface as a failed
 * publish either: the version carries a timestamp, so a re-run after a parse
 * failure mints a DIFFERENT version for the SAME commit and publishes it
 * successfully — two nightlies for one sha, no error anywhere. The blanket
 * `|| versions='[]'` this replaces did exactly that for any registry hiccup.
 *
 *   exit 0, JSON array or bare string → those versions. `--json` yields a bare
 *     STRING for a package with exactly one version, which the nightly package
 *     is once, right after its bootstrap publish.
 *   exit != 0 with an E404 error object → an empty list. The package genuinely
 *     does not exist yet; this is the bootstrap day and the only non-zero exit
 *     that means "nothing published."
 *   anything else — unparseable output, an empty body, a different error code,
 *     an unexpected shape → THROW, and let the caller fail the job.
 */
function parseVersionsResponse(raw, exitStatus) {
  const text = String(raw ?? "").trim();
  const status = Number(exitStatus ?? 0);
  let parsed;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `npm view did not return JSON (exit ${status}): ${text.slice(0, 200)}`
      );
    }
  }

  if (status !== 0) {
    if (parsed && parsed.error && parsed.error.code === "E404") return [];
    throw new Error(
      `npm view failed with exit ${status} and no E404 — refusing to assume this commit has no nightly: ${text.slice(0, 200)}`
    );
  }

  if (typeof parsed === "string") return [parsed];
  if (Array.isArray(parsed)) return parsed;
  throw new Error(
    `npm view returned neither a version list nor a version (exit ${status}): ${text.slice(0, 200)}`
  );
}

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

/**
 * The tarball `npm pack --json` says it wrote, from either shape npm emits.
 *
 * npm CHANGED THIS SHAPE, and the change is silent unless you look. npm <= 11
 * prints an ARRAY of pack results; npm 12 prints an OBJECT KEYED BY PACKAGE
 * NAME whose values are those same results. `const [entry] = JSON.parse(…)`
 * reads the first correctly and throws `object is not iterable` on the
 * second — which is what the first nightly built after the npm pin moved to
 * 12.0.1 did, after a successful pack, one step short of publishing.
 *
 * Both shapes are accepted rather than the pinned one alone: the pin exists so
 * publish behavior cannot change unreviewed, not so this script may assume a
 * single npm. It is also run locally, where npm is whatever the developer has.
 *
 * EXACTLY ONE ENTRY IS REQUIRED. packages/cli is one package and this pack
 * names one tarball to publish; more than one means npm packed something this
 * script did not intend, and picking the first would publish an arbitrary one
 * of them.
 */
function selectPackedFilename(stdout) {
  const text = String(stdout ?? "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`npm pack did not return JSON: ${text.slice(0, 200)}`);
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? Object.values(parsed)
      : [];
  if (entries.length !== 1) {
    throw new Error(
      `npm pack reported ${entries.length} tarballs, expected exactly 1: ${text.slice(0, 200)}`
    );
  }

  const filename = entries[0] && entries[0].filename;
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error(`npm pack reported no filename: ${text.slice(0, 200)}`);
  }
  return filename;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

/**
 * Parse argv into one of the two modes, and refuse anything that would let the
 * pack recompute a version the build has already been given.
 *
 * `printVersion: true` → `{ status, sha }`. `printVersion: false` →
 * `{ version, out }`. The flags of one mode are an ERROR in the other; a pack
 * that quietly ignored `--sha` would be a pack that could be handed a stale
 * version and a fresh sha and publish the disagreement.
 */
function parseArguments(argv) {
  const options = {
    out: join(REPO_ROOT, ".nightly-dist"),
    printVersion: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--print-version") {
      options.printVersion = true;
    } else if (argument === "--status") {
      index += 1;
      options.status = resolve(requireValue(argv, index, "--status"));
    } else if (argument === "--sha") {
      index += 1;
      options.sha = requireValue(argv, index, "--sha");
    } else if (argument === "--version") {
      index += 1;
      options.version = requireValue(argv, index, "--version");
    } else if (argument === "--out") {
      index += 1;
      options.out = resolve(requireValue(argv, index, "--out"));
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  if (options.printVersion) {
    if (options.version) {
      throw new Error("--version is not accepted with --print-version");
    }
    if (!options.status) {
      throw new Error("--status is required with --print-version");
    }
    if (!options.sha) {
      throw new Error("--sha is required with --print-version");
    }
    return options;
  }

  if (!options.version) {
    throw new Error(
      "--version is required; stamp it once with --print-version and pass the same value to the build and to this pack"
    );
  }
  if (options.status || options.sha) {
    throw new Error(
      "--status/--sha are only for --print-version; packing uses the version it was given and never recomputes one"
    );
  }
  if (!isValidVersion(options.version)) {
    throw new Error(
      `--version is not a valid semantic version: ${JSON.stringify(options.version)}`
    );
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

  if (options.printVersion) {
    const status = JSON.parse(readFileSync(options.status, "utf8"));
    const version = buildNightlyVersion({
      baseVersion: selectProposedVersion(status),
      date: new Date(),
      shortSha: options.sha,
    });
    // Only the version on stdout, so `$(… --print-version …)` is usable.
    console.log(version);
    setOutput("version", version);
    return;
  }

  const version = options.version;
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
  const readmePath = join(packageDirectory, "README.md");
  const committedReadme = readFileSync(readmePath, "utf8");

  writeFileSync(packageJsonPath, `${JSON.stringify(nightly, null, 2)}\n`);
  writeFileSync(readmePath, buildNightlyReadme(version));
  let packed;
  try {
    packed = spawnSync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", options.out],
      { cwd: packageDirectory, encoding: "utf8" }
    );
  } finally {
    writeFileSync(packageJsonPath, committed);
    writeFileSync(readmePath, committedReadme);
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
  const tarball = join(options.out, selectPackedFilename(packed.stdout));
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
  buildNightlyReadme,
  hasNightlyForSha,
  isValidVersion,
  parseArguments,
  parseVersionsResponse,
  selectPackedFilename,
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
