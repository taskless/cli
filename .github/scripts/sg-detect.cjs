#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * ast-grep — upstream detection.
 *
 * Answers one question: is the `@ast-grep/cli*` version pinned in
 * packages/cli/package.json behind the version npm serves as `latest`?
 *
 * WHY THIS EXISTS AT ALL. Vale has had `vale-detect.cjs` since the platform
 * packages were built, so a Vale release is noticed by a machine. ast-grep had
 * nothing: the eight `@ast-grep/cli*` pins sat wherever someone last put them
 * and nobody compared them to upstream. The `sg` badge therefore reports a
 * number that had no watcher, which is the whole reason it is worth rendering.
 *
 * WHERE IT DIVERGES FROM vale-detect.cjs, and why the divergence is not
 * carelessness:
 *
 *   - Upstream is an npm DIST-TAG, not a GitHub release. ast-grep ships to npm,
 *     and what a consumer would get from `@ast-grep/cli@latest` is the honest
 *     definition of "what we are behind by". Reading GitHub releases instead
 *     would compare our pin against a tag that may not be on npm yet.
 *
 *   - The pinned version is read from packages/cli/package.json, not from a
 *     manifest. There is no manifest to read: nothing here repackages ast-grep,
 *     so the dependency pins ARE the record of what we ship.
 *
 *   - The version comparison is local rather than imported from
 *     vale-release.cjs. Its `parseValeVersion` would do the arithmetic
 *     correctly and then report `not a plain Vale version: "0.45.x"` when
 *     ast-grep publishes something unexpected — an error message that lies
 *     about which dependency is in trouble. Fifteen lines of comparator is a
 *     better trade than a wrong error and a coupling that makes a Vale-specific
 *     edit able to break this badge.
 *
 * Usage:
 *   node .github/scripts/sg-detect.cjs [--json]
 *
 *   --json   print `{ pinned, upstream, ahead }` and nothing else. This script
 *            never writes anything in either mode; unlike Vale there is no
 *            manifest to rewrite, and bumping eight dependency pins is a
 *            lockfile-touching change that belongs to a human.
 *
 * Outputs (appended to $GITHUB_OUTPUT when set):
 *   update            "true" when upstream is ahead
 *   sg_version        the upstream version
 *   pinned_version    the version currently pinned in packages/cli/package.json
 */

const { appendFileSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const PACKAGE_JSON_PATH = join(
  __dirname,
  "..",
  "..",
  "packages",
  "cli",
  "package.json"
);

/** `@ast-grep/cli` itself and its per-platform siblings. */
const PIN_PATTERN = /^@ast-grep\/cli(-|$)/;

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

const REGISTRY = "https://registry.npmjs.org";

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  }
}

/**
 * Parse `major.minor.patch`, rejecting anything else — including a range
 * (`^0.41.0`) and a prerelease. Both are real states this can meet and neither
 * has a defensible answer: a range means the pin is not a pin, and a
 * prerelease on `latest` means upstream is doing something the badge should not
 * quietly average over.
 */
function parseVersion(text, what) {
  const match = VERSION_PATTERN.exec(String(text ?? "").trim());
  if (!match) {
    throw new Error(
      `${what} is not an exact major.minor.patch version: ${JSON.stringify(text)}`
    );
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `upstream` is a newer version than `pinned`. */
function isAhead(pinned, upstream) {
  const left = parseVersion(pinned, "the pinned ast-grep version");
  const right = parseVersion(upstream, "the upstream ast-grep version");
  for (const [index, value] of right.entries()) {
    if (value !== left[index]) {
      return value > left[index];
    }
  }
  return false;
}

/**
 * The one version every `@ast-grep/cli*` dependency is pinned to.
 *
 * Disagreement among them is an error rather than a "pick the highest",
 * because there is no version the badge could honestly show for a repository
 * that pins two. That state is also a real bug — the platform packages are
 * selected by optional dependency, so a straggler at an older version is a
 * different ast-grep on one platform than on the others — and a badge that
 * smoothed it over would hide exactly the drift it was added to expose.
 */
function collectPinnedVersion(packageJson) {
  const pins = new Map();
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    for (const [name, range] of Object.entries(packageJson[field] ?? {})) {
      if (PIN_PATTERN.test(name)) {
        pins.set(name, range);
      }
    }
  }

  if (pins.size === 0) {
    throw new Error(
      "packages/cli/package.json declares no @ast-grep/cli* dependency"
    );
  }

  const versions = new Set(pins.values());
  if (versions.size > 1) {
    const detail = [...pins]
      .map(([name, range]) => `${name}@${range}`)
      .sort()
      .join(", ");
    throw new Error(
      `@ast-grep/cli* pins disagree, so there is no single version to report: ${detail}`
    );
  }

  const [version] = versions;
  parseVersion(version, "the pinned ast-grep version");
  return version;
}

/**
 * What `npm install @ast-grep/cli` would resolve to today.
 *
 * The abbreviated packument (`application/vnd.npm.install-v1+json`) is what npm
 * itself asks for and is a small fraction of the full document, which carries
 * every version's metadata. Both expose `dist-tags`, which is the only field
 * read here.
 *
 * The scope separator is percent-encoded, as vale-gate.cjs does. The registry
 * happens to serve `/@ast-grep/cli` unescaped today — that was checked against
 * the real endpoint — but `/@scope%2Fname` is the documented form, it is what
 * the rest of this directory uses, and relying on a redirect nobody promised is
 * a strange thing to do to save one call.
 */
async function fetchLatestVersion(packageName) {
  const url = `${REGISTRY}/${packageName.replace("/", "%2F")}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.npm.install-v1+json",
      "user-agent": "taskless-skills-sg-detect",
    },
  });
  if (!response.ok) {
    throw new Error(`GET ${url} responded ${response.status}`);
  }
  const packument = await response.json();
  const latest = packument["dist-tags"]?.latest;
  if (typeof latest !== "string") {
    throw new TypeError(`${url} returned no dist-tags.latest`);
  }
  return latest;
}

async function main({
  argv = process.argv.slice(2),
  latestVersion = fetchLatestVersion,
  packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")),
} = {}) {
  const json = argv.includes("--json");
  const log = json ? () => {} : (line) => console.log(line);

  const pinned = collectPinnedVersion(packageJson);
  const upstream = await latestVersion("@ast-grep/cli");
  const ahead = isAhead(pinned, upstream);

  log(`pinned: ${pinned}   upstream latest: ${upstream}`);
  log(
    ahead
      ? `Upstream ${upstream} is ahead of ${pinned}. Bump every @ast-grep/cli* pin together.`
      : "Upstream is not ahead of the pinned version. Nothing to do."
  );

  const comparison = { pinned, upstream, ahead };
  if (json) {
    console.log(JSON.stringify(comparison));
  }

  setOutput("update", String(ahead));
  setOutput("sg_version", upstream);
  setOutput("pinned_version", pinned);
  return comparison;
}

// main() both prints and RETURNS the comparison, so update-badges.cjs can call
// it in-process and read the answer as data. Nothing should ever parse the
// human line above to recover a version that this return value already holds.
module.exports = { collectPinnedVersion, isAhead, main };

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nsg-detect failed: ${error.message}`);
    process.exitCode = 1;
  });
}
