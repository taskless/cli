#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * Vale — the CONSUMER half of the vendoring pipeline.
 *
 * THE TWO STAGES, and why this one was missing. `vale-detect.cjs` watches
 * upstream Vale and proposes a new manifest; merging that republishes the six
 * `@taskless/vale-*` platform packages at `<valeVersion>-<stamp>`. That is the
 * PRODUCER stage, and release-vale.yml says plainly what it does not do:
 * "publishing a platform package changes no consumer, because the CLI pins each
 * one exactly and a new version reaches a user only when someone reviews a bump
 * to that pin."
 *
 * That review has happened — by hand, every time. `git log` on the pins shows
 * 3.18.0, 3.19.0 and 3.20.0 each moved in a separate manual commit. So the
 * stage is not missing so much as unautomated, and what it costs is not a stale
 * pin but a dependency on somebody remembering: nothing detects that a publish
 * has landed and the pins are now behind, and nothing puts upstream's changelog
 * in front of whoever bumps them.
 *
 * This script is that detection. It asks whether a newer platform set exists on
 * npm and, with `--write`, moves every pin to it.
 *
 * WHY npm AND NOT THE MANIFEST. The manifest records what we intend to publish;
 * npm records what was actually published. Between the two sits a publish job
 * that can fail, and a pin bumped to a version npm does not serve is a broken
 * install rather than a stale one. The honest question for a consumer-side
 * upgrade is "what can be installed", so the registry is the source.
 *
 * WHY ALL SIX ARE READ, not one as a representative. The publish loop attempts
 * every package and reports failures at the end precisely because a partial set
 * is the one state the CLI's exact pins cannot tolerate — some platforms
 * resolvable, others not. Reading one package would upgrade the pins into that
 * state without noticing. Reading six costs six cheap requests and turns it
 * into a failed run.
 *
 * WHY THE COMPARISON IS vale-release.cjs's. Unlike sg-detect.cjs — which keeps
 * its own comparator so an ast-grep oddity cannot surface as an error message
 * about Vale — these versions really are Vale stamped versions, so
 * `compareStampedVersions` is both correct and the one place that already knows
 * a stamp's ordering rules.
 *
 * Usage:
 *   node .github/scripts/vale-upgrade-detect.cjs [--json] [--write] [--notes-out <path>]
 *
 * Outputs (appended to $GITHUB_OUTPUT when set):
 *   update            "true" when a newer published set exists
 *   vale_version      the newer stamped version
 *   pinned_version    the stamped version currently pinned
 *   base_version      the plain Vale version inside the newer stamp
 */

const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const { bumpPins } = require("./pin-bump.cjs");
const {
  fetchReleaseByTag,
  formatReleaseNotes,
  readNotesOut,
  writeNotesFile,
} = require("./release-notes.cjs");
const {
  assertManifest,
  assertStampedVersion,
  compareStampedVersions,
} = require("./vale-release.cjs");

const PACKAGE_JSON_PATH = join(
  __dirname,
  "..",
  "..",
  "packages",
  "cli",
  "package.json"
);

const MANIFEST_PATH = join(__dirname, "vale-manifest.json");

const PIN_PREFIX = "@taskless/vale-";

/**
 * What counts as a platform pin. Used BOTH to enumerate the pins and to rewrite
 * them, so the two cannot drift apart — the trailing hyphen is the boundary
 * here, since there is no bare `@taskless/vale` package.
 */
const PIN_PATTERN = /^@taskless\/vale-/;

const REGISTRY = "https://registry.npmjs.org";

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  }
}

/**
 * The one stamped version every `@taskless/vale-*` pin holds.
 *
 * Disagreement is an error for the same reason it is in sg-detect.cjs: the
 * platform packages are selected by optional dependency, so pins that disagree
 * are a different Vale on one platform than on the others. There is no version
 * this script could honestly report for that state, and picking the highest
 * would paper over exactly the drift worth surfacing.
 */
function collectPins(packageJson) {
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
      `packages/cli/package.json declares no ${PIN_PREFIX}* dependency`
    );
  }
  const versions = new Set(pins.values());
  if (versions.size > 1) {
    const detail = [...pins]
      .map(([name, range]) => `${name}@${range}`)
      .sort()
      .join(", ");
    throw new Error(
      `${PIN_PREFIX}* pins disagree, so there is no single version to upgrade from: ${detail}`
    );
  }
  const [version] = versions;
  assertStampedVersion(version);
  return { pins, version };
}

/** What `npm install <name>` would resolve to today. */
async function fetchLatestVersion(packageName) {
  const url = `${REGISTRY}/${packageName.replace("/", "%2F")}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.npm.install-v1+json",
      "user-agent": "taskless-vale-upgrade-detect",
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

/**
 * The version the whole set is published at.
 *
 * A set that does not agree is a half-finished publish, and upgrading into it
 * would pin some platforms to a version npm cannot serve. release-vale.yml's
 * publish loop is built to make this rare and re-runnable; this refuses to
 * build on it while it is true.
 */
async function resolvePublishedVersion(names, latestVersion) {
  const published = new Map(
    await Promise.all(
      names.map(async (name) => [name, await latestVersion(name)])
    )
  );
  const versions = new Set(published.values());
  if (versions.size > 1) {
    const detail = [...published]
      .map(([name, version]) => `${name}@${version}`)
      .sort()
      .join(", ");
    throw new Error(
      `the published ${PIN_PREFIX}* set is not at one version, so it is mid-publish or partially failed: ${detail}`
    );
  }
  const [version] = versions;
  assertStampedVersion(version);
  return version;
}

/** `3.21.0-20260914012345` -> `3.21.0`, the release upstream actually tagged. */
function baseVersion(stamped) {
  return assertStampedVersion(stamped).split("-")[0];
}

async function main({
  argv = process.argv.slice(2),
  latestVersion = fetchLatestVersion,
  releaseFor = fetchReleaseByTag,
  packageJsonPath = PACKAGE_JSON_PATH,
  packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")),
  manifest = assertManifest(JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))),
} = {}) {
  const json = argv.includes("--json");
  const write = argv.includes("--write");
  const notesOut = readNotesOut(argv);
  if (json && (write || notesOut)) {
    throw new Error(
      "--json prints the comparison and nothing else; it cannot be combined with --write or --notes-out"
    );
  }
  const log = json ? () => {} : (line) => console.log(line);

  const { pins, version: pinned } = collectPins(packageJson);
  const upstream = await resolvePublishedVersion(
    [...pins.keys()].sort(),
    latestVersion
  );
  const ahead = compareStampedVersions(upstream, pinned) > 0;

  log(`pinned: ${pinned}   published latest: ${upstream}`);
  log(
    ahead
      ? `A newer platform set is published. Move all ${pins.size} pins together.`
      : "The pins are current with what is published. Nothing to do."
  );

  const comparison = { pinned, upstream, ahead };
  if (json) {
    console.log(JSON.stringify(comparison));
  }

  if (write && ahead) {
    const source = readFileSync(packageJsonPath, "utf8");
    const { source: bumped, count } = bumpPins(source, {
      pattern: PIN_PATTERN,
      from: pinned,
      to: upstream,
    });
    if (count !== pins.size) {
      throw new Error(
        `expected to rewrite ${pins.size} ${PIN_PREFIX}* pins, rewrote ${count}`
      );
    }
    writeFileSync(packageJsonPath, bumped);
    log(`Rewrote ${count} pins in ${packageJsonPath} to ${upstream}.`);
  }

  // The changelog a reviewer wants is UPSTREAM's, not ours. Our stamp says when
  // the package was built; `v<base>` is the release whose behaviour changes.
  if (notesOut && ahead) {
    const base = baseVersion(upstream);
    const release = await releaseFor(manifest.upstream.repository, `v${base}`);
    writeNotesFile(
      notesOut,
      formatReleaseNotes({
        repository: manifest.upstream.repository,
        version: base,
        release,
      })
    );
    log(`Wrote the upstream release notes to ${notesOut}.`);
  }

  setOutput("update", String(ahead));
  setOutput("vale_version", upstream);
  setOutput("pinned_version", pinned);
  setOutput("base_version", baseVersion(upstream));
  return comparison;
}

module.exports = { baseVersion, collectPins, main, resolvePublishedVersion };

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nvale-upgrade-detect failed: ${error.message}`);
    process.exitCode = 1;
  });
}
