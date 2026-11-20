// SPDX-License-Identifier: MIT
/**
 * Publish gate — decide whether the pinned Vale version still needs publishing.
 *
 * WHY THIS EXISTS. The publish path fires on a push to main that touches
 * vale-manifest.json (plus explicit dispatch). That `paths:` filter cannot see
 * WHY the file changed: correcting a typo in its comment block, reformatting
 * it, or fixing a digest all look identical to a version bump, and each one
 * would publish seven fresh packages. Publishing is not idempotent here — every
 * run stamps <valeVersion>-<yyyymmddhhmmss>, a version npm has never seen — so
 * nothing downstream can absorb the mistake.
 *
 * WHY A "IS IT ALREADY PUBLISHED" CHECK WORKS HERE, given design.md D5 says it
 * cannot: D5 is right about the STAMPED version, which is novel by construction
 * and so always answers "not published". It is the BASE version that is
 * checkable. "Has anything been published for Vale 3.17.1?" is answered by
 * looking for a published version equal to 3.17.1 or beginning with `3.17.1-`,
 * which is exactly the set of stamps this workflow can mint for it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never suppresses an explicit dispatch:
 * a human asking for a publish gets one, stamp collision or not. And it skips
 * only when ALL seven packages (the six platform packages and the grammar
 * package) already carry the pinned base version. Checking a single package
 * would silently skip a half-published set, so requiring all seven makes the
 * gate double as partial-release repair — it re-runs precisely the
 * case the publish loop's failure aggregation is there to report.
 *
 * Usage:
 *   node .github/scripts/vale-gate.cjs [--force]
 *
 *   --force  publish regardless of what is already on the registry (dispatch).
 *
 * Outputs (appended to $GITHUB_OUTPUT when set):
 *   should_publish  "true" | "false"
 */
const { appendFileSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const { assertManifest, manifestPackages } = require("./vale-release.cjs");

const MANIFEST_PATH = join(__dirname, "vale-manifest.json");
const REGISTRY = "https://registry.npmjs.org";

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  }
}

/**
 * A published version counts as covering `pinned` when it is the bare version
 * or one of this workflow's stamps for it. The `-` is required: without it
 * `3.1.1` would be judged as covering pinned `3.1`, and a real upstream bump
 * would be skipped.
 */
function coversVersion(versions, pinned) {
  return versions.some(
    (version) => version === pinned || version.startsWith(`${pinned}-`)
  );
}

/**
 * A package that does not exist yet reads as "nothing published", not as an
 * error — that is the ordinary state before the one-time bootstrap publish, and
 * treating a 404 as a failure would wedge the gate closed exactly when the
 * packages most need publishing.
 */
async function fetchPublishedVersions(packageName) {
  const url = `${REGISTRY}/${packageName.replace("/", "%2F")}`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`GET ${url} responded ${response.status}`);
  }
  const document = await response.json();
  return Object.keys(document.versions ?? {});
}

/**
 * Pure decision, separated from the network so the table of cases is testable:
 * forced, nothing published, everything published, and a partial set.
 */
function planPublish({ manifest, publishedByPackage, forced }) {
  // Every package the manifest releases, the grammar package included: binaries
  // published without their grammars are not a published release.
  const missing = manifestPackages(manifest)
    .filter(
      (entry) =>
        !coversVersion(
          publishedByPackage[entry.package] ?? [],
          manifest.valeVersion
        )
    )
    .map((entry) => entry.package);

  if (forced) {
    return { shouldPublish: true, missing, reason: "forced" };
  }
  return {
    shouldPublish: missing.length > 0,
    missing,
    reason: missing.length > 0 ? "missing" : "already-published",
  };
}

async function main({
  argv = process.argv.slice(2),
  published = fetchPublishedVersions,
} = {}) {
  const forced = argv.includes("--force");
  const manifest = assertManifest(
    JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
  );

  // Concurrent, not sequential: the seven lookups are independent, and this job
  // exists to decide cheaply BEFORE prepare downloads ~60 MB. Sequential awaits
  // would make the gate seven round trips deep for no reason.
  const packages = manifestPackages(manifest);
  const publishedByPackage = Object.fromEntries(
    await Promise.all(
      packages.map(async (entry) => [
        entry.package,
        await published(entry.package),
      ])
    )
  );

  const plan = planPublish({ manifest, publishedByPackage, forced });

  console.log(`Vale ${manifest.valeVersion}`);
  for (const entry of packages) {
    const covered = !plan.missing.includes(entry.package);
    console.log(`  ${covered ? "published" : "MISSING  "}  ${entry.package}`);
  }

  if (plan.reason === "forced") {
    console.log(
      `\nExplicitly dispatched — publishing regardless (${plan.missing.length} of ${packages.length} not yet on the registry).`
    );
  } else if (plan.shouldPublish) {
    console.log(
      `\n${plan.missing.length} of ${packages.length} package(s) lack Vale ${manifest.valeVersion}. Publishing.`
    );
  } else {
    console.log(
      `\nEvery package already carries Vale ${manifest.valeVersion}. Nothing to publish; dispatch with phase=publish to force.`
    );
  }

  setOutput("should_publish", String(plan.shouldPublish));
  return plan;
}

// Exported so vale-gate.test.cjs can drive main() with the registry stubbed,
// and can exercise planPublish()'s cases without any network at all.
module.exports = { coversVersion, planPublish, main };

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nvale-gate failed: ${error.message}`);
    process.exitCode = 1;
  });
}
