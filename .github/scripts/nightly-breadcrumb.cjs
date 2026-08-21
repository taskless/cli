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

const REGION_OPEN = "<!-- nightly -->";
const REGION_CLOSE = "<!-- /nightly -->";

/**
 * The whole region, opening marker through closing marker. Non-greedy, so two
 * regions in a hand-mangled body are removed one at a time rather than
 * swallowing everything between the first open and the last close.
 */
const REGION_PATTERN = /<!-- nightly -->[\S\s]*?<!-- \/nightly -->/;

/**
 * The same pattern, global — a SEPARATE object rather than a `g` flag on the
 * one above, because a global regex carries `lastIndex` between `test()` calls
 * and would answer `hasRegion` differently on alternate invocations.
 */
const ALL_REGIONS_PATTERN = new RegExp(REGION_PATTERN.source, "g");

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
  return { builtAt, shortSha: sha };
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
 * Strip every nightly region from `body`, tidying only the whitespace the
 * removal itself left behind (a 3+ newline seam collapses to a blank line,
 * trailing whitespace goes). When there was no region the body is returned
 * BYTE-FOR-BYTE — a description that legitimately contains a run of blank
 * lines, or an indented code block, is never reflowed by a run that had nothing
 * to remove.
 */
function stripRegion(body) {
  const text = String(body ?? "");
  if (!hasRegion(text)) {
    return text.trimEnd();
  }
  return (
    text
      .replaceAll(ALL_REGIONS_PATTERN, "")
      .replaceAll(/\n{3,}/g, "\n\n")
      // Leading blank lines only ever appear here when the region sat at the very
      // top of the body; the first line's own indentation is untouched, so a
      // description opening with an indented code block is not reflowed.
      .replace(/^\n+/, "")
      .trimEnd()
  );
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
 * changesets are pending. The head ref is still matched here rather than
 * trusted from the query string, so a widened or mistyped filter cannot lead to
 * this writing its region onto an unrelated pull request.
 */
function selectVersionPullRequest(pulls, branch = VERSION_PR_BRANCH) {
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
      (pull.state === undefined || pull.state === "open")
  );
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

  const body = upsertRegion(pull.body ?? "", options.version);
  setOutput("pull_number", pull.number);
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
  NIGHTLY_PACKAGE,
  REGION_CLOSE,
  REGION_OPEN,
  VERSION_PR_BRANCH,
  hasRegion,
  parseArguments,
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
