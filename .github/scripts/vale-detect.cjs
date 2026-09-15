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
 *   node .github/scripts/vale-detect.cjs [--write] [--json]
 *
 *   --write  rewrite vale-manifest.json in place when upstream is ahead.
 *            Without it the script only reports, which is what a local
 *            "what would this do?" run wants.
 *
 *   --json   print `{ pinned, upstream, ahead }` and nothing else, then stop
 *            before the checksums download. update-badges.cjs needs the
 *            comparison and nothing else, and the alternative — scraping the
 *            "pinned: X   upstream latest: vY" line this script prints for a
 *            human — would rebuild, with a regex, a fact this script already
 *            holds as data. Implies read-only: --json never writes the
 *            manifest, because the badge run is not the run that proposes a
 *            pin, and skipping the checksums fetch is not a shortcut but the
 *            point (nothing is being verified here).
 *
 *   --notes-out <path>
 *            write upstream's release notes for the proposed version to <path>,
 *            rendered as a Markdown section. The detect workflow appends that
 *            file to the pull request body, so a reviewer can see what the bump
 *            contains without leaving the pull request. Written only when
 *            upstream is ahead; there is nothing to describe otherwise.
 *
 *            A path rather than a step output on purpose: release notes are
 *            third-party Markdown, and a $GITHUB_OUTPUT line is delimited text
 *            that a body containing the delimiter can break out of. A file
 *            passed to `--body-file` never meets an interpreter.
 *
 * Outputs (appended to $GITHUB_OUTPUT when set):
 *   update            "true" when upstream is ahead
 *   vale_version      the upstream version
 *   pinned_version    the version currently in the manifest
 */

const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const {
  fetchLatestRelease,
  formatReleaseNotes,
  writeNotesFile,
} = require("./release-notes.cjs");
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

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`GET ${url} responded ${response.status}`);
  }
  return response.text();
}

/** `--notes-out <path>`, or undefined when the flag is absent. */
function readNotesOut(argv) {
  const at = argv.indexOf("--notes-out");
  if (at === -1) {
    return undefined;
  }
  const path = argv[at + 1];
  if (!path || path.startsWith("--")) {
    throw new Error("--notes-out needs a path");
  }
  return path;
}

async function main({
  argv = process.argv.slice(2),
  latestRelease = fetchLatestRelease,
  text = fetchText,
} = {}) {
  const json = argv.includes("--json");
  const write = argv.includes("--write");
  const notesOut = readNotesOut(argv);
  // --json is a reporting mode and --write is a writing one. Refusing the
  // combination beats silently dropping whichever flag loses, since the caller
  // that passed both is wrong about what it is asking for.
  if (json && write) {
    throw new Error("--json is read-only; it cannot be combined with --write");
  }
  // Same reasoning as above: --json reports a comparison and writes nothing.
  if (json && notesOut) {
    throw new Error(
      "--json is read-only; it cannot be combined with --notes-out"
    );
  }
  // Everything a human wants to read is noise on stdout when a caller is
  // reading structured output from it.
  const log = json ? () => {} : (line) => console.log(line);
  const manifest = assertManifest(
    JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
  );

  // GitHub's `releases/latest` deliberately excludes prereleases and drafts, so
  // a Vale release candidate never trips detection. The same call carries the
  // release notes, so describing the bump costs no extra request.
  const release = await latestRelease(manifest.upstream.repository);
  if (!release) {
    throw new Error(
      `${manifest.upstream.repository} has no published releases to compare against`
    );
  }
  const upstreamTag = release.tag;
  log(`pinned: ${manifest.valeVersion}   upstream latest: ${upstreamTag}`);

  // Decide whether to go on with the two pure predicates directly, rather than
  // by calling planManifestUpdate with a placeholder checksums payload. That
  // shortcut looks equivalent but inverts the script: planManifestUpdate only
  // ignores `checksumsText` on the NOT-ahead path, so a stand-in empty string
  // makes it throw ("parsed to no entries") on exactly the runs that have
  // something to propose. The cheap check has to be the cheap check.
  const upstreamVersion = parseReleaseTag(upstreamTag);
  const ahead = isUpstreamAhead(manifest.valeVersion, upstreamVersion);

  // The structured answer, which is all a --json caller wanted. Reported here
  // rather than after the checksums fetch below: that download exists to
  // propose a manifest, and a badge run proposes nothing.
  const comparison = {
    pinned: manifest.valeVersion,
    upstream: upstreamVersion,
    ahead,
  };
  if (json) {
    console.log(JSON.stringify(comparison));
    setOutput("update", String(ahead));
    setOutput("vale_version", upstreamVersion);
    setOutput("pinned_version", manifest.valeVersion);
    return comparison;
  }

  if (!ahead) {
    log("Upstream is not ahead of the pinned version. Nothing to do.");
    setOutput("update", "false");
    setOutput("vale_version", upstreamVersion);
    setOutput("pinned_version", manifest.valeVersion);
    return comparison;
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

  // What the bump actually contains, for whoever reviews the digests. Written
  // only on the ahead path: the other paths propose nothing to describe.
  if (notesOut) {
    writeNotesFile(
      notesOut,
      formatReleaseNotes({
        repository: manifest.upstream.repository,
        version: plan.upstreamVersion,
        release,
      })
    );
    console.log(`Wrote the upstream release notes to ${notesOut}.`);
  }

  setOutput("update", "true");
  setOutput("vale_version", plan.upstreamVersion);
  setOutput("pinned_version", plan.pinnedVersion);
  return comparison;
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
