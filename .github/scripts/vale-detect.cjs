#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * Vale platform packages — upstream detection.
 *
 * The I/O half of the detect phase. It reads the latest upstream Vale release,
 * hands it plus the committed manifest to `planManifestUpdate` (pure, in
 * vale-release.cjs), and writes the rewritten manifest back when upstream is
 * ahead. It publishes nothing and needs no npm credential.
 *
 * What bounds a run is that comparison, and only that comparison (design D5). A
 * "is this version already on npm?" check could not do the job: every publish
 * stamps a timestamp npm has never seen, so such a check would answer "not
 * published" every single time and could never suppress anything.
 *
 * The two phases are separate because the trust boundary is code review. Detect
 * proposes new digests; a human reviews them; merging the manifest change is
 * what authorizes the publish run to fetch bytes matching those digests. A
 * single job that discovered a digest and then verified against the digest it
 * had just discovered would be verifying nothing.
 *
 * Usage:
 *   node .github/scripts/vale-detect.cjs [--write]
 *
 *   --write  rewrite vale-manifest.json in place when upstream is ahead.
 *            Without it the script only reports, which is what a local
 *            "what would this do?" run wants.
 *
 * Outputs (appended to $GITHUB_OUTPUT when set):
 *   update            "true" when upstream is ahead
 *   vale_version      the upstream version
 *   pinned_version    the version currently in the manifest
 */

const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const {
  applyTemplate,
  assertManifest,
  isUpstreamAhead,
  parseReleaseTag,
  planManifestUpdate,
  resolveChecksumsUrl,
} = require("./vale-release.cjs");

const MANIFEST_PATH = join(__dirname, "vale-manifest.json");

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  }
}

/**
 * GitHub's `releases/latest` deliberately excludes prereleases and drafts, so a
 * Vale release candidate never trips detection. `GITHUB_TOKEN`, when present,
 * is only for the API rate limit; the endpoint is public.
 */
async function fetchLatestTag(repository) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "taskless-skills-vale-detect",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const url = `https://api.github.com/repos/${repository}/releases/latest`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GET ${url} responded ${response.status}`);
  }
  const release = await response.json();
  if (typeof release.tag_name !== "string") {
    throw new TypeError(`${url} returned no tag_name`);
  }
  return release.tag_name;
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`GET ${url} responded ${response.status}`);
  }
  return response.text();
}

async function main({
  argv = process.argv.slice(2),
  latestTag = fetchLatestTag,
  text = fetchText,
} = {}) {
  const write = argv.includes("--write");
  const manifest = assertManifest(
    JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
  );

  const upstreamTag = await latestTag(manifest.upstream.repository);
  console.log(
    `pinned: ${manifest.valeVersion}   upstream latest: ${upstreamTag}`
  );

  // Decide whether to go on with the two pure predicates directly, rather than
  // by calling planManifestUpdate with a placeholder checksums payload. That
  // shortcut looks equivalent but inverts the script: planManifestUpdate only
  // ignores `checksumsText` on the NOT-ahead path, so a stand-in empty string
  // makes it throw ("parsed to no entries") on exactly the runs that have
  // something to propose. The cheap check has to be the cheap check.
  const upstreamVersion = parseReleaseTag(upstreamTag);
  if (!isUpstreamAhead(manifest.valeVersion, upstreamVersion)) {
    console.log("Upstream is not ahead of the pinned version. Nothing to do.");
    setOutput("update", "false");
    setOutput("vale_version", upstreamVersion);
    setOutput("pinned_version", manifest.valeVersion);
    return;
  }

  // Only now is the checksums file worth downloading: it belongs to a release
  // we are actually going to propose.
  const checksumsUrl = resolveChecksumsUrl(manifest, upstreamVersion);
  console.log(`fetching ${checksumsUrl}`);
  const checksumsText = await text(checksumsUrl);

  const plan = planManifestUpdate({ manifest, upstreamTag, checksumsText });
  console.log(
    `Upstream ${plan.upstreamVersion} is ahead of ${plan.pinnedVersion}.`
  );
  for (const platform of plan.manifest.platforms) {
    console.log(
      `  ${applyTemplate(platform.asset, { version: plan.upstreamVersion })}  ${platform.sha256}`
    );
  }

  if (write) {
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(plan.manifest, null, 2)}\n`);
    console.log(`\nRewrote ${MANIFEST_PATH}.`);
  } else {
    console.log("\nPass --write to update the manifest.");
  }

  setOutput("update", "true");
  setOutput("vale_version", plan.upstreamVersion);
  setOutput("pinned_version", plan.pinnedVersion);
}

// Exported (and only self-invoking as a script) so vale-detect.test.cjs can run
// main() with the two fetches stubbed. The bug that motivated this was in the
// composition — how main() sequences pure functions that were each already
// tested — which is reachable no other way.
module.exports = { main };

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nvale-detect failed: ${error.message}`);
    process.exitCode = 1;
  });
}
