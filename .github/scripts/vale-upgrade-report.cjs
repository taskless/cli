#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * What a Vale upgrade pull request needs a reviewer to see, and CI does not
 * show them: the contract suites' verdict, and the format readers upstream
 * added.
 *
 * THE CONTRACT VERDICT, BECAUSE VALIDATE DOES NOT RUN. vale-upgrade.yml opens
 * its pull request as `github-actions[bot]`, and every `pull_request` run that
 * actor triggers waits at `action_required` until a maintainer approves it.
 * Measured on every bot-opened upgrade so far, Vale and ast-grep alike: #427's
 * Validate sat at `action_required` with a 0s runtime, and on each earlier one
 * Validate first ran when a human pushed a child commit. So the red check the
 * workflow header relies on ("left to Validate, it is a red check on a pull
 * request that already carries upstream's notes") never appeared: #427 read as
 * a pull request with no checks, while three contract tests were failing.
 *
 * The suites are still NOT a gate. The header's reasoning stands: a changed
 * verdict is a measured edit for a child pull request, and gating on it turns
 * a scheduled run red every morning with no pull request to read. So the job
 * runs them, keeps going whatever they say, and this script puts the verdict
 * in the body.
 *
 * THE FORMAT READERS, BECAUSE NO TABLE CAN REPORT ONE. `VALE_FORMAT_TIERS` in
 * capabilities.ts is re-probed row by row on every bump, which catches a format
 * that MOVED. It cannot catch a format Vale LEARNED, since an extension with no
 * row is never probed; the table's own header asks for a source check instead,
 * by hand. 3.23.0 is the bump where nobody did it: `internal/lint/code/kt.go`
 * moved Kotlin from plaintext to the comment tier and every test stayed green.
 * The benign direction. The dangerous one is a reader that shells out to a
 * converter, which turns the same missing row into a crash that takes down the
 * run. Listing the files upstream ADDED under `internal/lint/` is the source
 * check, mechanically.
 *
 * Both halves report and never throw. A failed fetch or a missing test report
 * is said in the body rather than failing the run: the proposal is still worth
 * opening, and "we could not check" must not read like "nothing to see".
 */

const { readFileSync, writeFileSync } = require("node:fs");

const { baseVersion } = require("./vale-upgrade-detect.cjs");

/** The compare API returns at most this many files, with no marker when cut. */
const COMPARE_FILE_CAP = 300;

/** Where upstream keeps its format readers, and which of those files are. */
const READER_PREFIX = "internal/lint/";
const isReader = (filename) =>
  filename.startsWith(READER_PREFIX) &&
  filename.endsWith(".go") &&
  !filename.endsWith("_test.go");

/**
 * The failures in a vitest `--reporter=json` report.
 *
 * `undefined` when there is no report at all, which is a different finding
 * from zero failures: the suites did not run, or crashed before writing.
 */
function summarizeContract(report) {
  if (report === undefined) return undefined;
  const failed = [];
  for (const file of report.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status !== "failed") continue;
      failed.push({
        file: String(file.name ?? "").split("/").pop(),
        name: assertion.fullName,
        message: String(assertion.failureMessages?.[0] ?? "").split("\n")[0],
      });
    }
  }
  return { total: report.numTotalTests ?? 0, failed };
}

/** Read a vitest JSON report, or `undefined` if it was never written. */
function readContractReport(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * The reader files upstream added between two tags.
 *
 * Only ADDED files. A modified reader changes what a format sees, which the
 * release notes and the contract suites cover; an added one can route an
 * extension no row names, which only this covers.
 */
async function fetchAddedReaders(repository, from, to) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "taskless-vale-upgrade-report",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const url = `https://api.github.com/repos/${repository}/compare/v${from}...v${to}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GET ${url} responded ${response.status}`);
  }
  const files = (await response.json()).files ?? [];
  return {
    added: files
      .filter((file) => file.status === "added" && isReader(file.filename))
      .map((file) => file.filename)
      .toSorted(),
    complete: files.length < COMPARE_FILE_CAP,
    url: `https://github.com/${repository}/compare/v${from}...v${to}`,
  };
}

/** A fence no line of `text` can close early. */
function fence(text) {
  const longest = Math.max(
    2,
    ...[...text.matchAll(/`+/g)].map((match) => match[0].length)
  );
  const marker = "`".repeat(longest + 1);
  return `${marker}\n${text}\n${marker}`;
}

function formatContract(contract) {
  const heading = "### Contract suites";
  if (contract === undefined) {
    return `${heading}\n\n**Did not run.** No test report was written, so this upgrade has not been checked against the recorded contract. Run \`pnpm --filter @taskless/cli test --project cli vale-schema-contract vale-vendor-contract\` on this branch.\n`;
  }
  if (contract.failed.length === 0) {
    return `${heading}\n\nAll ${contract.total} tests in \`vale-schema-contract\` and \`vale-vendor-contract\` pass against the new binary. No recorded verdict changed.\n`;
  }
  const lines = contract.failed.map(
    (failure) => `${failure.file} > ${failure.name}\n  ${failure.message}`
  );
  return `${heading}\n\n**${contract.failed.length} of ${contract.total} failed.** The new Vale changed a recorded behaviour. The measured edit, the \`update\` ledger, and any migration belong in a child pull request that merges down into this branch.\n\n${fence(lines.join("\n"))}\n`;
}

function formatReaders(readers, error) {
  const heading = "### Format readers upstream added";
  if (readers === undefined) {
    return `${heading}\n\n**Could not check** (${error}). Compare \`internal/lint/\` between the two tags by hand before merging.\n`;
  }
  const caveat = readers.complete
    ? ""
    : `\n\nThe comparison touched ${COMPARE_FILE_CAP} or more files, where the API stops listing them, so this may be incomplete. Check [the full diff](${readers.url}).`;
  if (readers.added.length === 0) {
    return `${heading}\n\nNone under \`${READER_PREFIX}\` ([diff](${readers.url})). No extension can have changed tier without a row that re-probes it.${caveat}\n`;
  }
  const list = readers.added.map((file) => `- \`${file}\``).join("\n");
  return `${heading}\n\n${list}\n\nEach can route an extension that \`VALE_FORMAT_TIERS\` in \`capabilities.ts\` has no row for, and an unlisted extension is never probed. Find where \`internal/core/format.go\` sends it, probe the extension against the new binary, and add a row. A reader that needs an external converter is the dangerous case: the missing row becomes a crash that aborts every Vale rule in the run. ([diff](${readers.url}))${caveat}\n`;
}

function formatReport({ from, to, contract, readers, readersError }) {
  return `## Measured against Vale ${to}\n\nCompared with ${from}, which is what \`main\` pins. Validate on a pull request this workflow opens waits for a maintainer to approve it, so this section is the check that ran.\n\n${formatContract(contract)}\n${formatReaders(readers, readersError)}`;
}

function readArgument(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) {
    throw new Error(`missing ${name} <value>`);
  }
  return argv[index + 1];
}

async function main({
  argv = process.argv.slice(2),
  addedReaders = fetchAddedReaders,
  readReport = readContractReport,
} = {}) {
  const from = baseVersion(readArgument(argv, "--pinned"));
  const to = readArgument(argv, "--to");
  const repository = readArgument(argv, "--repository");
  const out = readArgument(argv, "--out");

  const contract = summarizeContract(readReport(readArgument(argv, "--contract")));
  let readers;
  let readersError;
  try {
    readers = await addedReaders(repository, from, to);
  } catch (error) {
    readersError = error.message;
  }

  const report = formatReport({ from, to, contract, readers, readersError });
  writeFileSync(out, report);
  console.log(report);
  return report;
}

module.exports = {
  COMPARE_FILE_CAP,
  fetchAddedReaders,
  formatReport,
  isReader,
  main,
  summarizeContract,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nvale-upgrade-report failed: ${error.message}`);
    process.exitCode = 1;
  });
}
