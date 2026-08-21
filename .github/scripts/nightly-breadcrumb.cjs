#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * The nightly build-info region on the changesets "Version Packages" pull
 * request.
 *
 * After a nightly publishes, the open `changeset-release/main` pull request
 * gains a region naming the build a reviewer can install to try the work the
 * pending changesets describe:
 *
 *     <!-- nightly -->
 *     ### Build Info
 *     `npx @taskless/cli-nightly@0.11.0-20260818123456x05b3c88`
 *
 *     **Built from:** 05b3c88
 *     **Built at:** 2026-08-18 12:34:56
 *     <!-- /nightly -->
 *
 * EVERY FACT IN THAT REGION COMES FROM THE STAMPED VERSION, and there is no
 * second source for any of them. The version is stamped exactly once per run
 * (nightly-pack.cjs `--print-version`) because the build bakes it into the
 * skills the tarball ships; re-reading the clock here would print a "Built at"
 * that disagrees with the version printed one line above it, and re-reading
 * `git rev-parse` would print a sha the published package does not carry. The
 * version already encodes both — `<n.m.k>-<yyyymmddhhmmss>x<sha>` — so this
 * file parses them back out rather than being handed a second opinion.
 *
 * THE REGION IS REMOVED AND RE-APPENDED, never edited in place. Deleting it is
 * a supported thing for a human to do, and the next nightly puts it back at the
 * END of the body — which is where it belongs regardless of where a previous
 * one sat, so a body someone has reordered converges instead of accumulating.
 * That also makes the upsert idempotent by construction: N publishes leave one
 * region, not N.
 *
 * It coexists with `<!-- stack -->` … `<!-- /stack -->`, which
 * stack-breadcrumb.yml may be maintaining on the same body. The two are keyed
 * on different names and neither pattern can match the other's markers; this
 * one never rewrites a region it does not own.
 *
 * THE CONVERSE DOES NOT HOLD, AND CANNOT BE FIXED FROM HERE. If the Version
 * Packages pull request is ever part of a stack that carries `<!-- PR:N -->`
 * regions, stack-breadcrumb.cjs's `canonicalizeBody` re-lays the whole body as
 * breadcrumb → description → carried regions. Its `ownDescription` strips only
 * the regions IT owns, so this one travels inside "description" and lands
 * ABOVE the carried blocks — no longer at the end. Nothing here runs at that
 * moment, so "at the end" is a property of each write rather than of the body
 * for all time (the spec says so in those words). The next publish moves the
 * region back, which is the same self-healing the lost-update window relies on
 * — see the workflow header. Teaching the other canonicalizer about this
 * region would be the real fix, and it belongs in that file, on a change that
 * can test it there.
 *
 * There is NO GitHub I/O here. The workflow fetches the pull request list with
 * `gh api` and applies the body with `gh api -X PATCH` (never `gh pr edit` —
 * its GraphQL path is broken by GitHub's Projects-classic deprecation), so this
 * file stays zero-dependency CommonJS that `node --test` can exercise directly.
 *
 * Usage:
 *
 *     node .github/scripts/nightly-breadcrumb.cjs \
 *       --version <stamped-version> --pulls <pulls.json> --out <body.md>
 *
 * `--pulls` is the JSON body of `GET /repos/{owner}/{repo}/pulls` filtered to
 * the head branch. AN EMPTY LIST IS SUCCESS: `changeset-release/main` only
 * exists while changesets are pending, and a nightly can publish in the seconds
 * before changesets opens it. A cosmetic breadcrumb must never fail a run that
 * already published to npm. A failed API call is a different thing entirely and
 * is left to fail — the workflow lets `gh api` exit non-zero rather than
 * folding "the query returned nothing" and "the query did not run" together.
 *
 * Writes `pull_number` and `changed` to $GITHUB_OUTPUT when it is set, and the
 * new body to `--out` only when something actually changed.
 */

const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

/** The package a nightly is published under — NOT the released `@taskless/cli`. */
const NIGHTLY_PACKAGE = "@taskless/cli-nightly";

/** The head branch changesets opens its "Version Packages" pull request from. */
const VERSION_PR_BRANCH = "changeset-release/main";

/** The base branch that pull request targets — matched, not assumed. */
const DEFAULT_BRANCH = "main";

const REGION_OPEN = "<!-- nightly -->";
const REGION_CLOSE = "<!-- /nightly -->";

/**
 * The install line inside a region, which is where the version a previous
 * publish wrote can be read back from. Built from `NIGHTLY_PACKAGE` rather than
 * spelled out, so renaming the package cannot leave the reader looking for a
 * name the renderer no longer writes.
 */
const INSTALL_LINE_PATTERN = new RegExp(
  `\`npx ${NIGHTLY_PACKAGE.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`)}@([^\`\\s]+)\``
);

/**
 * The whole region, opening marker through closing marker. Non-greedy, so two
 * regions in a hand-mangled body are removed one at a time rather than
 * swallowing everything between the first open and the last close.
 */
const REGION_PATTERN = /<!-- nightly -->[\S\s]*?<!-- \/nightly -->/;

/**
 * Every region TOGETHER WITH the blank lines around it — the seam that removing
 * it leaves behind. A SEPARATE object rather than a `g` flag on the one above,
 * because a global regex carries `lastIndex` between `test()` calls and would
 * answer `hasRegion` differently on alternate invocations.
 *
 * Capturing the surrounding newlines is what keeps this from touching prose. A
 * blanket `\n{3,}` → `\n\n` pass over the whole body would also collapse an
 * intentional run of blank lines somewhere else in the description — on every
 * publish, silently rewriting text this file does not own.
 */
const REGION_SEAM_PATTERN = new RegExp(`\\n*${REGION_PATTERN.source}\\n*`, "g");

/**
 * The stamped prerelease identifier, anchored to the end: `-<14 digits>x<sha>`.
 * Same grammar nightly-pack.cjs writes (design D3), read in the other
 * direction.
 */
const STAMP_PATTERN = /-(\d{14})x([0-9a-f]{7,40})$/;

/**
 * Split a stamped nightly version back into the two facts it encodes.
 *
 * Throws rather than degrading: a version this cannot parse is not a nightly
 * version, and rendering "Built at: unknown" next to an install line would put
 * a plausible-looking breadcrumb on a pull request describing a build nobody
 * can account for.
 */
function parseStampedVersion(version) {
  const match = STAMP_PATTERN.exec(String(version ?? ""));
  if (!match) {
    throw new Error(
      `not a stamped nightly version: ${JSON.stringify(version)} (expected <n.m.k>-<yyyymmddhhmmss>x<sha>)`
    );
  }
  const [, stamp, sha] = match;
  const builtAt = [
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`,
    `${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}`,
  ].join(" ");
  // The stamp is UTC by construction (formatStampTimestamp uses toISOString),
  // so this is a reformat, not a conversion — no clock and no timezone is
  // consulted anywhere in this file.
  const parsed = new Date(`${builtAt.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`stamped version carries an impossible time: ${version}`);
  }
  // `stamp` is the raw 14 digits: fixed-width and UTC, so a lexical compare of
  // two of them orders the builds (see isNewerBuild).
  return { builtAt, shortSha: sha, stamp };
}

/** Render the region for `version`, markers included, with no trailing newline. */
function renderRegion(version) {
  const { builtAt, shortSha } = parseStampedVersion(version);
  return [
    REGION_OPEN,
    "### Build Info",
    `\`npx ${NIGHTLY_PACKAGE}@${version}\``,
    "",
    `**Built from:** ${shortSha}`,
    `**Built at:** ${builtAt}`,
    REGION_CLOSE,
  ].join("\n");
}

/** Does `body` already carry a nightly region? */
function hasRegion(body) {
  return REGION_PATTERN.test(String(body ?? ""));
}

/**
 * Strip every nightly region from `body`, touching ONLY the whitespace at the
 * seam the removal leaves behind.
 *
 * The normalization is scoped to the match, not applied to the body: the
 * pattern eats the blank lines on either side of the region and the replacer
 * decides what belongs there — a blank line when the region sat between two
 * pieces of prose, nothing when it sat at the top or the bottom. Prose
 * elsewhere is never rewritten, so an intentional run of blank lines in the
 * description survives every republish. (A blanket `\n{3,}` → `\n\n` pass would
 * collapse it, silently, on a body this file does not own.)
 *
 * A body with no region is returned unchanged apart from `trimEnd()`.
 */
function stripRegion(body) {
  const text = String(body ?? "");
  if (!hasRegion(text)) {
    return text.trimEnd();
  }
  return text
    .replaceAll(REGION_SEAM_PATTERN, (match, offset, full) => {
      const atStart = offset === 0;
      const atEnd = offset + match.length === full.length;
      return atStart || atEnd ? "" : "\n\n";
    })
    .trimEnd();
}

/**
 * Upsert the region for `version`: remove whatever region is present and append
 * the fresh one at the END of the body.
 *
 * Remove-then-append rather than replace-in-place, so the region is at the end
 * no matter where the previous one sat — a body a human has reordered, or one
 * whose region was manually deleted, converges to the same string. Idempotent:
 * running it twice with the same version returns the same body.
 */
function upsertRegion(body, version) {
  const region = renderRegion(version);
  const description = stripRegion(body);
  return description.length === 0 ? region : `${description}\n\n${region}`;
}

/**
 * Pick the open "Version Packages" pull request out of what the pulls query
 * returned, or `undefined` when there is none.
 *
 * `undefined` is a NORMAL answer, not an error: the branch exists only while
 * changesets are pending.
 *
 * BOTH REFS ARE MATCHED HERE, not just the head, and neither is trusted from
 * the query string. GitHub allows several open pull requests from ONE head
 * branch to different bases, so `head=<owner>:changeset-release/main` alone can
 * return more than one — a second PR opened from that branch for testing, say —
 * and a `.find()` on the head ref would then write this region onto whichever
 * the API happened to list first. The one this workflow means is the one
 * changesets opens, which targets the default branch. The workflow's query
 * filters on both as well; this is the check that holds if that query is ever
 * widened or mistyped.
 */
function selectVersionPullRequest(
  pulls,
  branch = VERSION_PR_BRANCH,
  base = DEFAULT_BRANCH
) {
  if (!Array.isArray(pulls)) {
    throw new Error(
      "the pulls response is not an array — expected the body of GET /repos/{owner}/{repo}/pulls"
    );
  }
  return pulls.find(
    (pull) =>
      pull &&
      pull.head &&
      pull.head.ref === branch &&
      pull.base &&
      pull.base.ref === base &&
      (pull.state === undefined || pull.state === "open")
  );
}

/**
 * The version named by the region already on `body`, or `undefined` when there
 * is none (or when the region has been edited past recognition).
 */
function readRegionVersion(body) {
  const region = REGION_PATTERN.exec(String(body ?? ""));
  if (!region) {
    return undefined;
  }
  const match = INSTALL_LINE_PATTERN.exec(region[0]);
  return match ? match[1] : undefined;
}

/**
 * Is `candidate` a LATER build than `existing`? Used to keep this write
 * monotonic.
 *
 * ORDERING ACROSS RUNS IS NOT GUARANTEED BY `needs:`. That only orders jobs
 * within one run, and this workflow deliberately has no concurrency group (see
 * the file header — gate 2 is per-SHA, so two runs cannot both publish). Two
 * pushes to `main` in quick succession therefore start two independent runs,
 * and nothing stops the OLDER run's breadcrumb job from reaching the PATCH
 * after the newer one did. Without this check that older job would leave the
 * pull request advertising a build that has already been superseded — an
 * install line pointing at yesterday's nightly, with every run green.
 *
 * A concurrency group would be the wrong instrument: it would also cancel
 * in-progress PUBLISHES, trading a cosmetic staleness for a lost package. The
 * comparison is on the 14-digit UTC stamp, which is fixed-width, so a lexical
 * compare orders builds chronologically for any base version (design D3 chose
 * that layout for exactly this).
 */
function isNewerBuild(candidate, existing) {
  if (existing === undefined) {
    return true;
  }
  let existingStamp;
  try {
    existingStamp = parseStampedVersion(existing).stamp;
  } catch {
    // The region was edited into something unrecognizable. Treat it as absent
    // and rewrite it: a body carrying a broken region should converge.
    return true;
  }
  return parseStampedVersion(candidate).stamp > existingStamp;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--version") {
      index += 1;
      options.version = requireValue(argv, index, "--version");
    } else if (argument === "--pulls") {
      index += 1;
      options.pulls = resolve(requireValue(argv, index, "--pulls"));
    } else if (argument === "--out") {
      index += 1;
      options.out = resolve(requireValue(argv, index, "--out"));
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  for (const flag of ["version", "pulls", "out"]) {
    if (!options[flag]) {
      throw new Error(`--${flag} is required`);
    }
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
  const pulls = JSON.parse(readFileSync(options.pulls, "utf8"));
  const pull = selectVersionPullRequest(pulls);

  if (!pull) {
    // Not a failure. See the header: no open Version Packages pull request is
    // an ordinary state, and the nightly has already published.
    console.log(
      `No open ${VERSION_PR_BRANCH} pull request — nothing to annotate.`
    );
    setOutput("changed", "false");
    return;
  }

  setOutput("pull_number", pull.number);

  // Monotonic: an older run that reaches this point after a newer one wrote
  // must not roll the pull request back to the build it published. See
  // isNewerBuild — job ordering across runs is not guaranteed and a concurrency
  // group would cancel publishes to fix a cosmetic race.
  const present = readRegionVersion(pull.body ?? "");
  if (!isNewerBuild(options.version, present)) {
    console.log(
      `#${pull.number} already names ${present}, which is not older than ${options.version} — leaving it alone.`
    );
    setOutput("changed", "false");
    return;
  }

  const body = upsertRegion(pull.body ?? "", options.version);
  if (body === (pull.body ?? "")) {
    console.log(`#${pull.number} already carries this build's region.`);
    setOutput("changed", "false");
    return;
  }

  writeFileSync(options.out, body);
  console.log(`#${pull.number}: build info for ${options.version}`);
  setOutput("changed", "true");
}

module.exports = {
  DEFAULT_BRANCH,
  NIGHTLY_PACKAGE,
  REGION_CLOSE,
  REGION_OPEN,
  VERSION_PR_BRANCH,
  hasRegion,
  isNewerBuild,
  parseArguments,
  readRegionVersion,
  parseStampedVersion,
  renderRegion,
  selectVersionPullRequest,
  stripRegion,
  upsertRegion,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`\nnightly-breadcrumb failed: ${error.message}`);
    process.exitCode = 1;
  }
}
