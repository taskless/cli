// SPDX-License-Identifier: MIT
"use strict";

/**
 * Requirement visibility check — catch specs the OpenSpec parser silently
 * stops reading part-way through.
 *
 * WHY THIS EXISTS. `openspec validate --all --strict` answers "is what I read
 * well-formed", not "did I read the whole file". A spec's requirements live
 * under `## Requirements`, and a second `##` heading inside that section ends
 * it: every `### Requirement:` below the intruding heading is no longer a
 * requirement to the parser, it is prose. Those requirements are not invalid,
 * they are INVISIBLE — so `--strict` reports success having never looked at
 * them. Measured before this check existed, `infrastructure` carried 20
 * requirements with 1 visible and `skills` carried 7 with 1, both green the
 * whole time. A passing gate is an active claim that the spec was read, which
 * makes this failure mode worse than a red check rather than milder.
 *
 * WHAT IT CHECKS. For each `openspec/specs/<capability>/spec.md`: the number of
 * `### Requirement:` headings in the file must equal the number the parser can
 * reach. Any difference fails, naming the spec and the count.
 *
 * FENCED CODE BLOCKS ARE NOT SPEC CONTENT. Lines inside a ``` or ~~~ fence are
 * skipped entirely — they neither count as requirements nor open or close the
 * requirements section. Spec files do contain fenced examples, and a fenced
 * `### Requirement:` is documentation ABOUT the format, not a requirement the
 * parser was ever meant to see; counting it would report a hidden requirement
 * that does not exist and push authors to mangle their examples. Skipping
 * fences costs nothing in detection power: the `cli-help` defect this family of
 * bugs comes from was a LOST OPENING fence, which turns the block's `##` lines
 * into real headings — and real headings are exactly what this check reads.
 *
 * AN UNCLOSED FENCE IS ITSELF A FAILURE. Skipping fenced content has one edge:
 * a lost opening fence leaves the block's CLOSING ``` dangling, and a dangling
 * fence opens a region that runs to end of file, hiding everything after it
 * from this check as well as from the parser. So a fence still open at EOF
 * fails outright rather than being tolerated — the one case where "I could not
 * read the rest of the file" is the finding.
 *
 * Usage:
 *   node .github/scripts/openspec-visibility.cjs [specsDirectory]
 *
 * Exits non-zero when any spec has requirements the parser cannot see.
 */
const { readdirSync, readFileSync, existsSync } = require("node:fs");
const { join, relative, resolve } = require("node:path");

const REPO_ROOT = join(__dirname, "..", "..");
const DEFAULT_SPECS_DIRECTORY = join(REPO_ROOT, "openspec", "specs");

const REQUIREMENTS_HEADING = "## Requirements";
const REQUIREMENT_PREFIX = "### Requirement:";

/**
 * A fence opens on ``` or ~~~ (up to three leading spaces, per CommonMark) and
 * closes on a run of the same character at least as long. Tracking the opener's
 * length and character is what lets a ```` ```` ```` block contain a ``` line
 * without the check losing its place.
 */
function fenceOf(line) {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  return match ? { char: match[1][0], length: match[1].length } : null;
}

/**
 * Count requirements written in a spec against requirements the parser reaches.
 * Pure and string-in, so the interesting cases are testable without a fixture
 * tree on disk.
 */
function countRequirements(source) {
  let total = 0;
  let visible = 0;
  let inRequirements = false;
  let openFence = null;

  for (const line of source.split("\n")) {
    const fence = fenceOf(line);
    if (openFence) {
      if (
        fence &&
        fence.char === openFence.char &&
        fence.length >= openFence.length
      ) {
        openFence = null;
      }
      continue;
    }
    if (fence) {
      openFence = fence;
      continue;
    }

    if (line.startsWith("## ")) {
      inRequirements = line.trim() === REQUIREMENTS_HEADING;
    } else if (line.startsWith(REQUIREMENT_PREFIX)) {
      total += 1;
      if (inRequirements) {
        visible += 1;
      }
    }
  }

  return {
    total,
    visible,
    hidden: total - visible,
    unclosedFence: openFence !== null,
  };
}

/** Every `<capability>/spec.md` under the specs directory, sorted for stable output. */
function findSpecs(specsDirectory) {
  if (!existsSync(specsDirectory)) {
    return [];
  }
  return readdirSync(specsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(specsDirectory, entry.name, "spec.md"))
    .filter((path) => existsSync(path))
    .sort();
}

/** Repo-relative when the spec lives in the repo, absolute otherwise (tests, ad-hoc runs). */
function displayPath(path) {
  const relativePath = relative(REPO_ROOT, path);
  return relativePath.startsWith("..") ? path : relativePath;
}

function checkSpecs(specsDirectory = DEFAULT_SPECS_DIRECTORY) {
  return findSpecs(specsDirectory).map((path) => ({
    path,
    ...countRequirements(readFileSync(path, "utf8")),
  }));
}

function main({ argv = process.argv.slice(2) } = {}) {
  const specsDirectory = argv[0]
    ? resolve(process.cwd(), argv[0])
    : DEFAULT_SPECS_DIRECTORY;
  const results = checkSpecs(specsDirectory);

  if (results.length === 0) {
    console.error(`No specs found under ${specsDirectory}`);
    return { results, ok: false };
  }

  for (const result of results) {
    const name = displayPath(result.path);
    const status =
      result.hidden > 0
        ? "HIDDEN  "
        : result.unclosedFence
          ? "UNCLOSED"
          : "ok      ";
    console.log(
      `  ${status}  ${name}  ${result.visible}/${result.total} requirement(s) visible`
    );
  }

  const broken = results.filter(
    (result) => result.hidden > 0 || result.unclosedFence
  );
  if (broken.length === 0) {
    console.log(
      `\nEvery requirement in ${results.length} spec(s) is visible to the parser.`
    );
    return { results, ok: true };
  }

  console.error("");
  for (const result of broken) {
    const name = displayPath(result.path);
    if (result.hidden > 0) {
      console.error(
        `${name}: ${result.hidden} requirement(s) hidden by a '##' heading inside '## Requirements' (${result.visible} of ${result.total} visible)`
      );
    }
    if (result.unclosedFence) {
      console.error(
        `${name}: a code fence is still open at end of file, so everything after it is unreadable to this check and to the parser (likely a lost opening fence leaving its closer dangling)`
      );
    }
  }
  if (broken.some((result) => result.hidden > 0)) {
    console.error(
      "\nA '##' heading ends the requirements section. Use a bold lead-in line for topical grouping instead, so the requirements below it stay readable to the parser."
    );
  }
  return { results, ok: false };
}

// Exported so openspec-visibility.test.cjs can drive the counter over inline
// sources and main() over a temporary spec tree, with nothing on disk to keep.
module.exports = { countRequirements, findSpecs, checkSpecs, main };

if (require.main === module) {
  try {
    if (!main().ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`\nopenspec-visibility failed: ${error.message}`);
    process.exitCode = 1;
  }
}
