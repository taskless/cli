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

async function main() {
  const write = process.argv.slice(2).includes("--write");
  const manifest = assertManifest(
    JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
  );

  const upstreamTag = await fetchLatestTag(manifest.upstream.repository);
  console.log(
    `pinned: ${manifest.valeVersion}   upstream latest: ${upstreamTag}`
  );

  // Probe first with an empty checksums file. When upstream is not ahead the
  // plan short-circuits and never looks at it, so the checksums file is only
  // downloaded for a release we are actually going to propose.
  const probe = planManifestUpdate({
    manifest,
    upstreamTag,
    checksumsText: "",
  });
  if (!probe.update) {
    console.log("Upstream is not ahead of the pinned version. Nothing to do.");
    setOutput("update", "false");
    setOutput("vale_version", probe.upstreamVersion);
    setOutput("pinned_version", manifest.valeVersion);
    return;
  }

  const checksumsUrl = resolveChecksumsUrl(manifest, probe.upstreamVersion);
  console.log(`fetching ${checksumsUrl}`);
  const checksumsText = await fetchText(checksumsUrl);

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

main().catch((error) => {
  console.error(`\nvale-detect failed: ${error.message}`);
  process.exitCode = 1;
});
